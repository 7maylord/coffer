export type SettlementAdapterId = 'mock' | 'near-testnet' | 'near-intents';
export type AssetEnvironment = 'mock' | 'testnet' | 'mainnet';
export type AssetKind = 'native' | 'token';

export interface AssetDefinition {
  assetId: string;
  adapter: SettlementAdapterId;
  environment: AssetEnvironment;
  network: string;
  symbol: string;
  decimals: number;
  kind: AssetKind;
  tokenContract?: string;
  testOnly: boolean;
  discoverySource: 'static' | 'verified-contract' | 'provider';
}

const staticAssets: readonly AssetDefinition[] = [
  {
    assetId: 'mock:base:usdc',
    adapter: 'mock',
    environment: 'mock',
    network: 'base-like',
    symbol: 'USDC',
    decimals: 6,
    kind: 'token',
    testOnly: true,
    discoverySource: 'static',
  },
  {
    assetId: 'mock:near:usdc',
    adapter: 'mock',
    environment: 'mock',
    network: 'near-like',
    symbol: 'USDC',
    decimals: 6,
    kind: 'token',
    testOnly: true,
    discoverySource: 'static',
  },
  {
    assetId: 'near:testnet:native',
    adapter: 'near-testnet',
    environment: 'testnet',
    network: 'near-testnet',
    symbol: 'NEAR',
    decimals: 24,
    kind: 'native',
    testOnly: true,
    discoverySource: 'static',
  },
];

export class AssetRegistryError extends Error {}

export class AssetRegistry {
  private readonly assets = new Map<string, AssetDefinition>(
    staticAssets.map((asset) => [asset.assetId, asset]),
  );

  list(): AssetDefinition[] {
    return [...this.assets.values()].map((asset) => ({ ...asset }));
  }

  require(assetId: string): AssetDefinition {
    const asset = this.assets.get(assetId);
    if (!asset) throw new AssetRegistryError('Unknown canonical asset');
    return { ...asset };
  }

  registerVerifiedTestToken(contractAccountId: string): AssetDefinition {
    if (
      contractAccountId.length < 2 ||
      contractAccountId.length > 64 ||
      !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(contractAccountId)
    ) {
      throw new AssetRegistryError('Invalid NEAR test token contract account');
    }
    const asset: AssetDefinition = {
      assetId: `near:testnet:nep141:${contractAccountId}`,
      adapter: 'near-testnet',
      environment: 'testnet',
      network: 'near-testnet',
      symbol: 'ctUSD',
      decimals: 6,
      kind: 'token',
      tokenContract: contractAccountId,
      testOnly: true,
      discoverySource: 'verified-contract',
    };
    this.add(asset);
    return { ...asset };
  }

  registerProviderAsset(asset: AssetDefinition): void {
    if (
      asset.adapter !== 'near-intents' ||
      asset.environment !== 'mainnet' ||
      asset.discoverySource !== 'provider' ||
      asset.testOnly ||
      asset.decimals < 0 ||
      asset.decimals > 77 ||
      !Number.isInteger(asset.decimals)
    ) {
      throw new AssetRegistryError('Invalid provider-discovered asset');
    }
    this.add(asset);
  }

  assertAdapter(
    assetId: string,
    adapter: SettlementAdapterId,
  ): AssetDefinition {
    const asset = this.require(assetId);
    if (asset.adapter !== adapter) {
      throw new AssetRegistryError('Asset is not valid for selected adapter');
    }
    return asset;
  }

  private add(asset: AssetDefinition): void {
    const current = this.assets.get(asset.assetId);
    if (current && JSON.stringify(current) !== JSON.stringify(asset)) {
      throw new AssetRegistryError('Canonical asset metadata cannot change');
    }
    this.assets.set(asset.assetId, Object.freeze({ ...asset }));
  }
}
