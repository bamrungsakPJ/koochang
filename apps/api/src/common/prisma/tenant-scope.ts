import { PrismaClient } from '@prisma/client';

/**
 * Models that belong to a tenant. Every query on these through a scoped client gets
 * `tenantId` forced into its `where` / `data`. Add new tenant-owned models here.
 */
const TENANT_MODELS = new Set<string>(['Membership', 'Invite', 'DomainEvent']);

const WHERE_OPERATIONS = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

type Data = Record<string, unknown>;

function withTenant(data: Data, tenantId: number): Data {
  if ('tenant' in data) {
    throw new Error('Tenant-scoped writes must not set the `tenant` relation directly');
  }
  if (data.tenantId !== undefined && data.tenantId !== tenantId) {
    throw new Error('Cross-tenant write rejected');
  }
  return { ...data, tenantId };
}

/**
 * Returns a Prisma client that can only see and write rows of `tenantId`.
 * Interactive transactions started from it (`scoped.$transaction(async tx => …)`) keep the scope.
 */
export function tenantScoped(client: PrismaClient, tenantId: number) {
  return client.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);

          const scopedArgs = { ...(args as Record<string, unknown>) } as Record<string, any>;
          if (WHERE_OPERATIONS.has(operation)) {
            const where = scopedArgs.where ?? {};
            if (where.tenantId !== undefined && where.tenantId !== tenantId) {
              throw new Error('Cross-tenant query rejected');
            }
            // Prisma allows extra non-unique filters on unique `where` (findUnique/update/delete).
            scopedArgs.where = { ...where, tenantId };
          }
          if (operation === 'create') {
            scopedArgs.data = withTenant(scopedArgs.data, tenantId);
          }
          if (operation === 'createMany') {
            scopedArgs.data = Array.isArray(scopedArgs.data)
              ? scopedArgs.data.map((d: Data) => withTenant(d, tenantId))
              : withTenant(scopedArgs.data, tenantId);
          }
          if (operation === 'upsert') {
            scopedArgs.create = withTenant(scopedArgs.create, tenantId);
          }
          return query(scopedArgs as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof tenantScoped>;
