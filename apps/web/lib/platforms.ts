import { catalog, type ProviderId } from '@postwerk/providers/catalog';

export const providerLabels = Object.fromEntries(Object.values(catalog).map((info) => [info.id, info.name])) as Record<ProviderId, string>;
