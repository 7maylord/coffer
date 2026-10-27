import { AssetRegistry } from './asset-registry.js';

describe('AssetRegistry', () => {
  it('uses canonical identity instead of symbols', () => {
    const registry = new AssetRegistry();
    expect(registry.require('mock:near:usdc')).toMatchObject({
      symbol: 'USDC',
      decimals: 6,
      adapter: 'mock',
    });
    expect(registry.require('near:testnet:native')).toMatchObject({
      symbol: 'NEAR',
      decimals: 24,
      adapter: 'near-testnet',
    });
    expect(() => registry.require('USDC')).toThrow('Unknown canonical asset');
  });

  it('binds ctUSD to its exact verified testnet contract account', () => {
    const registry = new AssetRegistry();
    const asset = registry.registerVerifiedTestToken('token.coffer.testnet');
    expect(asset).toMatchObject({
      assetId: 'near:testnet:nep141:token.coffer.testnet',
      tokenContract: 'token.coffer.testnet',
      decimals: 6,
      testOnly: true,
    });
    expect(() => registry.assertAdapter(asset.assetId, 'near-intents')).toThrow(
      'selected adapter',
    );
  });

  it('rejects static metadata replacement and unverified provider assets', () => {
    const registry = new AssetRegistry();
    expect(() =>
      registry.registerProviderAsset({
        ...registry.require('mock:base:usdc'),
        adapter: 'near-intents',
      }),
    ).toThrow('provider-discovered');
  });

  it('accepts immutable provider discovery metadata and rejects replacement', () => {
    const registry = new AssetRegistry();
    const providerAsset = {
      assetId: 'nep141:usdc.omft.near',
      adapter: 'near-intents' as const,
      environment: 'mainnet' as const,
      network: 'near-mainnet',
      symbol: 'USDC',
      decimals: 6,
      kind: 'token' as const,
      testOnly: false,
      discoverySource: 'provider' as const,
    };
    expect(() => registry.registerProviderAsset(providerAsset)).not.toThrow();
    expect(() => registry.registerProviderAsset(providerAsset)).not.toThrow();
    expect(() =>
      registry.registerProviderAsset({ ...providerAsset, decimals: 18 }),
    ).toThrow('cannot change');
    expect(() => registry.registerVerifiedTestToken('INVALID')).toThrow(
      'Invalid NEAR',
    );
  });
});
