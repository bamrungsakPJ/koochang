import { DEFAULT_ASSET_CATEGORIES } from '@serviceflow/shared';
import { Prisma } from '@prisma/client';
import { newPublicId } from './ids';

interface CategoryDb {
  assetCategory: {
    createMany(args: { data: Prisma.AssetCategoryCreateManyInput[] }): PromiseLike<unknown>;
  };
}

/** Starter categories so a new shop can register equipment immediately (zero setup). */
export function seedDefaultCategories(db: CategoryDb, tenantId: number) {
  return db.assetCategory.createMany({
    data: DEFAULT_ASSET_CATEGORIES.map((c, i) => ({
      publicId: newPublicId(),
      tenantId,
      name: c.name,
      issueTypesJson: JSON.stringify(c.issueTypes),
      sortOrder: i,
    })),
  });
}
