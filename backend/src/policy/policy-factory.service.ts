import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { baseDecode, baseEncode } from 'near-api-js';
import { z } from 'zod';
import type { SessionPrincipal } from '../auth/auth.types.js';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import {
  NEAR_FINAL_VIEW_CLIENT,
  policyConfigurationSchema,
  type NearFinalViewClient,
} from './near-policy-contract.js';
import { DeterministicPolicyEngine } from './policy-engine.js';
import { commitment } from './proposal-digest.js';
import {
  POLICY_STORE,
  PolicyAuthorizationError,
  PolicyConflictError,
  type PolicyStore,
} from './policy.types.js';

const digest = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);
const instanceSchema = z
  .object({
    organization_commitment: digest,
    account_id: z.string(),
    requested_by: z.string(),
    status: z.literal('Active'),
  })
  .passthrough();
const amount = z.string().regex(/^[1-9][0-9]*$/);

@Injectable()
export class PolicyFactoryService {
  constructor(
    @Inject(POLICY_STORE) private readonly store: PolicyStore,
    @Inject(NEAR_FINAL_VIEW_CLIENT)
    private readonly client: NearFinalViewClient,
    @Inject(DeterministicPolicyEngine)
    private readonly engine: DeterministicPolicyEngine,
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {}

  async prepare(principal: SessionPrincipal, organizationId: string) {
    const settings = this.settings();
    const policy = await this.trustedPolicy(organizationId);
    const eligibleApprovers = await this.store.eligibleContractApprovers(
      organizationId,
      this.environment.NEAR_NETWORK,
    );
    if (
      !eligibleApprovers.some(
        ({ userId, role, accountId }) =>
          userId === principal.userId &&
          role === 'OWNER' &&
          principal.wallets.some(
            (wallet) =>
              wallet.network === this.environment.NEAR_NETWORK &&
              wallet.accountId === accountId,
          ),
      )
    )
      throw new ServiceUnavailableException('Verified owner wallet required');
    if (
      new Set(eligibleApprovers.map(({ userId }) => userId)).size <
      policy.rules.approvalThreshold
    ) {
      throw new ConflictException('Not enough distinct verified approvers');
    }
    const snapshot = await this.factorySnapshot(settings);
    const organizationCommitment = commitment(
      'coffer:organization:v1',
      organizationId,
    );
    return {
      factoryAccountId: settings.factoryId,
      provisionerAccountId: settings.provisionerId,
      methodName: 'create_policy_instance',
      organizationCommitment: organizationCommitment.toString('base64'),
      policyDigest: Buffer.from(policy.digest, 'hex').toString('base64'),
      approvalThreshold: policy.rules.approvalThreshold,
      eligibleApprovers,
      minimumDepositYocto: snapshot.minimumDepositYocto,
      expectedInstanceAccountId: `${organizationCommitment.subarray(0, 16).toString('hex')}.${settings.factoryId}`,
    };
  }

  async previewSponsoredCall(
    principal: SessionPrincipal,
    organizationId: string,
    selection: { controller: string; approvers: string[] },
  ) {
    const prepared = await this.prepare(principal, organizationId);
    const existing = await this.store.contractBinding(organizationId);
    if (existing)
      throw new ConflictException('Organization already has a policy contract');
    const selected = selection.approvers.map((account) =>
      prepared.eligibleApprovers.find(({ accountId }) => accountId === account),
    );
    if (
      selection.approvers.length < prepared.approvalThreshold ||
      selection.approvers.length > 16 ||
      new Set(selection.approvers).size !== selection.approvers.length ||
      selected.some((candidate) => !candidate) ||
      new Set(selected.map((candidate) => candidate?.userId)).size !==
        selected.length ||
      !selection.approvers.includes(selection.controller) ||
      !prepared.eligibleApprovers.some(
        ({ userId, role, accountId }) =>
          userId === principal.userId &&
          role === 'OWNER' &&
          accountId === selection.controller &&
          principal.wallets.some(
            (wallet) =>
              wallet.network === this.environment.NEAR_NETWORK &&
              wallet.accountId === accountId,
          ),
      )
    )
      throw new ForbiddenException(
        'Distinct verified owner and approvers required',
      );
    const status = await this.client.view(
      prepared.factoryAccountId,
      'get_instance',
      { organization_commitment: prepared.organizationCommitment },
    );
    if (status.value !== null)
      throw new ConflictException('Policy instance already pending or active');
    return {
      network: this.environment.NEAR_NETWORK,
      signerId: prepared.provisionerAccountId,
      receiverId: prepared.factoryAccountId,
      methodName: prepared.methodName,
      args: {
        organization_commitment: prepared.organizationCommitment,
        controller: selection.controller,
        policy_digest: prepared.policyDigest,
        approvers: [...selection.approvers].sort(),
        approval_threshold: prepared.approvalThreshold,
      },
      gas: '150000000000000',
      depositYocto: prepared.minimumDepositYocto,
      expectedInstanceAccountId: prepared.expectedInstanceAccountId,
    };
  }

  async bind(principal: SessionPrincipal, organizationId: string) {
    const settings = this.settings();
    const policy = await this.trustedPolicy(organizationId);
    const organizationCommitment = commitment(
      'coffer:organization:v1',
      organizationId,
    );
    const commitmentBase64 = organizationCommitment.toString('base64');
    try {
      const snapshot = await this.factorySnapshot(settings);
      const instanceResult = await this.client.view(
        settings.factoryId,
        'get_instance',
        { organization_commitment: commitmentBase64 },
        snapshot.blockHash,
      );
      const instance = instanceSchema.parse(instanceResult.value);
      const accountId = `${organizationCommitment.subarray(0, 16).toString('hex')}.${settings.factoryId}`;
      if (
        instanceResult.blockHash !== snapshot.blockHash ||
        instance.organization_commitment !== commitmentBase64 ||
        instance.account_id !== accountId ||
        instance.requested_by !== settings.provisionerId
      )
        throw new Error('Factory instance mismatch');
      const [configResult, codeHash, accessKeys] = await Promise.all([
        this.client.view(
          accountId,
          'get_configuration',
          {},
          snapshot.blockHash,
        ),
        this.client.codeHash(accountId, snapshot.blockHash),
        this.client.accessKeys(accountId, snapshot.blockHash),
      ]);
      const config = policyConfigurationSchema.parse(configResult.value);
      if (
        configResult.blockHash !== snapshot.blockHash ||
        codeHash !== settings.policyCodeHash ||
        accessKeys !== 0 ||
        config.organization_commitment !== commitmentBase64 ||
        config.policy_digest !==
          Buffer.from(policy.digest, 'hex').toString('base64') ||
        config.configuration_version !== '1' ||
        config.frozen ||
        config.approval_threshold !== policy.rules.approvalThreshold ||
        !config.approvers.includes(config.controller) ||
        !principal.wallets.some(
          (wallet) =>
            wallet.network === this.environment.NEAR_NETWORK &&
            wallet.accountId === config.controller,
        )
      )
        throw new Error('Policy instance configuration mismatch');
      return await this.store.bindVerifiedContract({
        organizationId,
        actorUserId: principal.userId,
        network: this.environment.NEAR_NETWORK,
        contractAccountId: accountId,
        expectedCodeHash: settings.policyCodeHash,
        organizationCommitment: organizationCommitment.toString('hex'),
        policyDigest: policy.digest,
        policyVersion: policy.version,
        approvalThreshold: policy.rules.approvalThreshold,
        controller: config.controller,
        approvers: config.approvers,
      });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      if (error instanceof PolicyConflictError)
        throw new ConflictException(error.message);
      if (error instanceof PolicyAuthorizationError)
        throw new ForbiddenException(error.message);
      throw new ServiceUnavailableException(
        'Policy factory instance could not be verified',
      );
    }
  }

  private async trustedPolicy(organizationId: string) {
    const policy = await this.store.activePolicy(organizationId);
    if (!policy)
      throw new ServiceUnavailableException('Active policy required');
    // shortcut: factory bootstrap starts at version 1; add quorum-governed sync before binding older organizations.
    if (policy.version !== 1)
      throw new ConflictException(
        'Policy version must be 1 for factory bootstrap',
      );
    try {
      if (
        this.engine.policyDigest(this.engine.normalizeRules(policy.rules)) !==
        policy.digest
      ) {
        throw new Error('Policy digest mismatch');
      }
      return policy;
    } catch {
      throw new ServiceUnavailableException(
        'Active policy integrity check failed',
      );
    }
  }

  private settings() {
    const factoryId = this.environment.NEAR_POLICY_FACTORY_ACCOUNT_ID;
    const factoryCodeHash = this.environment.NEAR_POLICY_FACTORY_CODE_HASH;
    const provisionerId = this.environment.NEAR_POLICY_PROVISIONER_ACCOUNT_ID;
    const policyCodeHash = this.environment.NEAR_POLICY_CODE_HASH;
    if (!factoryId || !factoryCodeHash || !provisionerId || !policyCodeHash) {
      throw new ServiceUnavailableException('Policy factory is not configured');
    }
    try {
      if (
        baseDecode(factoryCodeHash).length !== 32 ||
        baseDecode(policyCodeHash).length !== 32
      ) {
        throw new Error('Invalid hash length');
      }
    } catch {
      throw new ServiceUnavailableException('Invalid policy factory hashes');
    }
    return { factoryId, factoryCodeHash, provisionerId, policyCodeHash };
  }

  private async factorySnapshot(
    settings: ReturnType<PolicyFactoryService['settings']>,
  ) {
    try {
      const hashResult = await this.client.view(
        settings.factoryId,
        'get_policy_code_hash',
        {},
      );
      const factoryPolicyHash = digest.parse(hashResult.value);
      const [codeHash, provisionerResult, minimumResult] = await Promise.all([
        this.client.codeHash(settings.factoryId, hashResult.blockHash),
        this.client.view(
          settings.factoryId,
          'get_provisioner',
          {},
          hashResult.blockHash,
        ),
        this.client.view(
          settings.factoryId,
          'minimum_deployment_deposit',
          {},
          hashResult.blockHash,
        ),
      ]);
      if (
        codeHash !== settings.factoryCodeHash ||
        baseEncode(Buffer.from(factoryPolicyHash, 'base64')) !==
          settings.policyCodeHash ||
        provisionerResult.blockHash !== hashResult.blockHash ||
        provisionerResult.value !== settings.provisionerId ||
        minimumResult.blockHash !== hashResult.blockHash
      )
        throw new Error('Factory configuration mismatch');
      return {
        blockHash: hashResult.blockHash,
        minimumDepositYocto: amount.parse(minimumResult.value),
      };
    } catch {
      throw new ServiceUnavailableException(
        'Policy factory could not be verified',
      );
    }
  }
}
