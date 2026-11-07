/**
 * Frontend client for /api/media-library — favorites, collections, tags, trash.
 */

import { getJson, postJson, putJson, deleteJson, fetchJson } from "./typed-fetch";
import type {
  Collection,
  CollectionDetail,
  Tag,
  TrashItem,
  FavoriteToggleResponse,
  CreateCollectionRequest,
  CreateTagRequest,
  ItemOrganization,
} from "./types";

const BASE = "/api/media-library";

/* --------------------------------------------------------------------------- */
/* Favorites                                                                   */
/* --------------------------------------------------------------------------- */

export async function listMediaFavorites(limit = 200): Promise<string[]> {
  return getJson<string[]>(`${BASE}/favorites?limit=${encodeURIComponent(String(limit))}`, { timeout: 15000 });
}

export async function isMediaFavorite(relativePath: string): Promise<boolean> {
  return getJson<{ favorited: boolean }>(
    `${BASE}/favorites/${encodeURIComponent(relativePath)}/status`,
    { timeout: 15000 },
  ).then((r) => r.favorited);
}

export async function toggleMediaFavorite(relativePath: string): Promise<FavoriteToggleResponse> {
  return postJson<FavoriteToggleResponse>(
    `${BASE}/favorites/${encodeURIComponent(relativePath)}`,
    {},
    { timeout: 15000 },
  );
}

/* --------------------------------------------------------------------------- */
/* Collections                                                                 */
/* --------------------------------------------------------------------------- */

export async function listCollections(): Promise<Collection[]> {
  return getJson<Collection[]>(`${BASE}/collections`, { timeout: 15000 });
}

export async function createCollection(body: CreateCollectionRequest): Promise<Collection> {
  return postJson<Collection>(`${BASE}/collections`, body, { timeout: 15000 });
}

export async function getCollectionDetail(collectionId: string): Promise<CollectionDetail> {
  return getJson<CollectionDetail>(`${BASE}/collections/${encodeURIComponent(collectionId)}`, { timeout: 15000 });
}

export async function updateCollection(
  collectionId: string,
  body: CreateCollectionRequest,
): Promise<Collection> {
  return putJson<Collection>(`${BASE}/collections/${encodeURIComponent(collectionId)}`, body, { timeout: 15000 });
}

export async function deleteCollection(collectionId: string): Promise<void> {
  await deleteJson<void>(`${BASE}/collections/${encodeURIComponent(collectionId)}`, { timeout: 15000 });
}

export async function listCollectionItems(collectionId: string): Promise<string[]> {
  return getJson<string[]>(
    `${BASE}/collections/${encodeURIComponent(collectionId)}/items`,
    { timeout: 15000 },
  );
}

export async function addItemToCollection(collectionId: string, relativePath: string): Promise<void> {
  await postJson<void>(
    `${BASE}/collections/${encodeURIComponent(collectionId)}/items`,
    { relative_path: relativePath },
    { timeout: 15000 },
  );
}

export async function removeItemFromCollection(collectionId: string, relativePath: string): Promise<void> {
  await deleteJson<void>(
    `${BASE}/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(relativePath)}`,
    { timeout: 15000 },
  );
}

export async function listItemCollections(relativePath: string): Promise<Collection[]> {
  return getJson<Collection[]>(
    `${BASE}/items/${encodeURIComponent(relativePath)}/collections`,
    { timeout: 15000 },
  );
}

/* --------------------------------------------------------------------------- */
/* Tags                                                                        */
/* --------------------------------------------------------------------------- */

export async function listTags(): Promise<Tag[]> {
  return getJson<Tag[]>(`${BASE}/tags`, { timeout: 15000 });
}

export async function createTag(body: CreateTagRequest): Promise<Tag> {
  return postJson<Tag>(`${BASE}/tags`, body, { timeout: 15000 });
}

export async function listTagItems(tagId: string): Promise<string[]> {
  return getJson<string[]>(`${BASE}/tags/${encodeURIComponent(tagId)}/items`, { timeout: 15000 });
}

export async function listItemTags(relativePath: string): Promise<Tag[]> {
  return getJson<{ tags: Tag[] }>(
    `${BASE}/items/${encodeURIComponent(relativePath)}/tags`,
    { timeout: 15000 },
  ).then((r) => r.tags);
}

export async function listItemOrganization(): Promise<ItemOrganization> {
  return getJson<ItemOrganization>(`${BASE}/items/organization`, { timeout: 15000 });
}

export async function addItemTag(relativePath: string, tagId: string): Promise<void> {
  await postJson<void>(
    `${BASE}/items/${encodeURIComponent(relativePath)}/tags/${encodeURIComponent(tagId)}`,
    {},
    { timeout: 15000 },
  );
}

export async function removeItemTag(relativePath: string, tagId: string): Promise<void> {
  await deleteJson<void>(
    `${BASE}/items/${encodeURIComponent(relativePath)}/tags/${encodeURIComponent(tagId)}`,
    { timeout: 15000 },
  );
}

export async function setItemTags(relativePath: string, tagIds: string[]): Promise<Tag[]> {
  return putJson<Tag[]>(
    `${BASE}/items/${encodeURIComponent(relativePath)}/tags`,
    { relative_paths: [relativePath], tag_ids: tagIds },
    { timeout: 15000 },
  );
}

/* --------------------------------------------------------------------------- */
/* Trash                                                                       */
/* --------------------------------------------------------------------------- */

export async function moveItemToTrash(
  relativePath: string,
  retentionDays = 30,
): Promise<TrashItem> {
  return postJson<TrashItem>(
    `${BASE}/trash?retention_days=${encodeURIComponent(String(retentionDays))}`,
    { relative_path: relativePath },
    { timeout: 15000 },
  );
}

export async function listTrash(): Promise<TrashItem[]> {
  return getJson<TrashItem[]>(`${BASE}/trash`, { timeout: 15000 });
}

export async function restoreFromTrash(relativePath: string): Promise<boolean> {
  return postJson<{ restored: boolean }>(
    `${BASE}/trash/${encodeURIComponent(relativePath)}/restore`,
    {},
    { timeout: 15000 },
  ).then((r) => r.restored);
}

export async function purgeFromTrash(relativePath: string): Promise<void> {
  await deleteJson<void>(
    `${BASE}/trash/${encodeURIComponent(relativePath)}`,
    { timeout: 15000 },
  );
}

export async function emptyTrash(): Promise<number> {
  return fetchJson<{ removed: number }>(`${BASE}/trash`, { method: "DELETE", timeout: 15000 })
    .then((r) => r.removed);
}