import { fetchWithTimeout } from "../fetchWithTimeout";

export interface Collection {
  id: string;
  name: string;
  cover_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface CollectionDetail extends Collection {
  item_count: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface TrashItem {
  relative_path: string;
  file_type: string;
  deleted_at: string;
  expires_at: string;
}

const MEDIA_LIBRARY_BASE = "/api/media-library";

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

export interface FavoriteToggleResponse {
  relative_path: string;
  favorited: boolean;
}

export async function listMediaFavorites(
  limit: number = 200
): Promise<string[]> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/favorites?limit=${encodeURIComponent(
      String(limit)
    )}`,
    { timeout: 15000 }
  );
  if (!res.ok) throw new Error("Failed to list favorites");
  return (await res.json()) as string[];
}

export async function isMediaFavorite(
  relativePath: string
): Promise<boolean> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/favorites/${encodeURIComponent(
      relativePath
    )}/status`,
    { timeout: 15000 }
  );
  if (!res.ok) return false;
  const data = (await res.json()) as { favorited: boolean };
  return !!data.favorited;
}

export async function toggleMediaFavorite(
  relativePath: string
): Promise<FavoriteToggleResponse> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/favorites/${encodeURIComponent(relativePath)}`,
    { method: "POST", timeout: 15000 }
  );
  if (!res.ok) throw new Error("Failed to toggle favorite");
  return (await res.json()) as FavoriteToggleResponse;
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export interface CreateCollectionRequest {
  name: string;
  cover_path?: string | null;
}

export async function listCollections(): Promise<Collection[]> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/collections`,
    { timeout: 15000 }
  );
  if (!res.ok) throw new Error("Failed to list collections");
  return (await res.json()) as Collection[];
}

export async function createCollection(
  body: CreateCollectionRequest
): Promise<Collection> {
  
  const res = await fetchWithTimeout(`${MEDIA_LIBRARY_BASE}/collections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeout: 15000,
  });
  if (!res.ok) throw new Error("Failed to create collection");
  return (await res.json()) as Collection;
}

export async function getCollectionDetail(
  collectionId: string
): Promise<CollectionDetail> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/collections/${encodeURIComponent(collectionId)}`,
    { timeout: 15000 }
  );
  if (!res.ok) throw new Error("Failed to get collection");
  return (await res.json()) as CollectionDetail;
}

export async function updateCollection(
  collectionId: string,
  body: CreateCollectionRequest
): Promise<Collection> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/collections/${encodeURIComponent(collectionId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeout: 15000,
    }
  );
  if (!res.ok) throw new Error("Failed to update collection");
  return (await res.json()) as Collection;
}

export async function deleteCollection(collectionId: string): Promise<void> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/collections/${encodeURIComponent(collectionId)}`,
    { method: "DELETE", timeout: 15000 }
  );
  if (!res.ok) throw new Error("Failed to delete collection");
}

export async function listCollectionItems(
  collectionId: string
): Promise<string[]> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/collections/${encodeURIComponent(
      collectionId
    )}/items`,
    { timeout: 15000 }
  );
  if (!res.ok) throw new Error("Failed to list collection items");
  return (await res.json()) as string[];
}

export async function addItemToCollection(
  collectionId: string,
  relativePath: string
): Promise<void> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/collections/${encodeURIComponent(
      collectionId
    )}/items`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relative_path: relativePath }),
      timeout: 15000,
    }
  );
  if (!res.ok) throw new Error("Failed to add item to collection");
}

export async function removeItemFromCollection(
  collectionId: string,
  relativePath: string
): Promise<void> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/collections/${encodeURIComponent(
      collectionId
    )}/items/${encodeURIComponent(relativePath)}`,
    { method: "DELETE", timeout: 15000 }
  );
  if (!res.ok) throw new Error("Failed to remove item from collection");
}

export async function listItemCollections(
  relativePath: string
): Promise<Collection[]> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/items/${encodeURIComponent(
      relativePath
    )}/collections`,
    { timeout: 15000 }
  );
  if (!res.ok) throw new Error("Failed to list item collections");
  return (await res.json()) as Collection[];
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export interface CreateTagRequest {
  name: string;
  color?: string;
}

export async function listTags(): Promise<Tag[]> {
  
  const res = await fetchWithTimeout(`${MEDIA_LIBRARY_BASE}/tags`, {
    timeout: 15000,
  });
  if (!res.ok) throw new Error("Failed to list tags");
  return (await res.json()) as Tag[];
}

export async function createTag(body: CreateTagRequest): Promise<Tag> {
  
  const res = await fetchWithTimeout(`${MEDIA_LIBRARY_BASE}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeout: 15000,
  });
  if (!res.ok) throw new Error("Failed to create tag");
  return (await res.json()) as Tag;
}

export async function listTagItems(tagId: string): Promise<string[]> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/tags/${encodeURIComponent(tagId)}/items`,
    { timeout: 15000 }
  );
  if (!res.ok) throw new Error("Failed to list tag items");
  return (await res.json()) as string[];
}

export async function listItemTags(
  relativePath: string
): Promise<Tag[]> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/items/${encodeURIComponent(
      relativePath
    )}/tags`,
    { timeout: 15000 }
  );
  if (!res.ok) throw new Error("Failed to list item tags");
  return (await res.json()) as Tag[];
}

export async function addItemTag(
  relativePath: string,
  tagId: string
): Promise<void> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/items/${encodeURIComponent(
      relativePath
    )}/tags/${encodeURIComponent(tagId)}`,
    { method: "POST", timeout: 15000 }
  );
  if (!res.ok) throw new Error("Failed to add tag to item");
}

export async function removeItemTag(
  relativePath: string,
  tagId: string
): Promise<void> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/items/${encodeURIComponent(
      relativePath
    )}/tags/${encodeURIComponent(tagId)}`,
    { method: "DELETE", timeout: 15000 }
  );
  if (!res.ok) throw new Error("Failed to remove tag from item");
}

export interface SetItemTagsRequest {
  relative_paths: string[];
  tag_ids: string[];
}

export async function setItemTags(
  relativePath: string,
  tagIds: string[]
): Promise<Tag[]> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/items/${encodeURIComponent(relativePath)}/tags`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relative_paths: [relativePath], tag_ids: tagIds }),
      timeout: 15000,
    }
  );
  if (!res.ok) throw new Error("Failed to set item tags");
  const data = (await res.json()) as { tags: Tag[] };
  return data.tags ?? [];
}

// ---------------------------------------------------------------------------
// Trash
// ---------------------------------------------------------------------------

export interface MoveToTrashRequest {
  relative_path: string;
}

export async function moveItemToTrash(
  relativePath: string,
  retentionDays: number = 30
): Promise<TrashItem> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/trash?retention_days=${encodeURIComponent(
      String(retentionDays)
    )}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relative_path: relativePath }),
      timeout: 15000,
    }
  );
  if (!res.ok) throw new Error("Failed to move item to trash");
  return (await res.json()) as TrashItem;
}

export async function listTrash(): Promise<TrashItem[]> {
  
  const res = await fetchWithTimeout(`${MEDIA_LIBRARY_BASE}/trash`, {
    timeout: 15000,
  });
  if (!res.ok) throw new Error("Failed to list trash");
  return (await res.json()) as TrashItem[];
}

export async function restoreFromTrash(
  relativePath: string
): Promise<boolean> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/trash/${encodeURIComponent(
      relativePath
    )}/restore`,
    { method: "POST", timeout: 15000 }
  );
  if (!res.ok) throw new Error("Failed to restore item from trash");
  const data = (await res.json()) as { restored: boolean };
  return !!data.restored;
}

export async function purgeFromTrash(relativePath: string): Promise<void> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/trash/${encodeURIComponent(relativePath)}`,
    { method: "DELETE", timeout: 15000 }
  );
  if (!res.ok) throw new Error("Failed to purge item from trash");
}

export async function emptyTrash(): Promise<number> {
  
  const res = await fetchWithTimeout(
    `${MEDIA_LIBRARY_BASE}/trash`,
    { method: "DELETE", timeout: 15000 }
  );
  if (!res.ok) throw new Error("Failed to empty trash");
  const data = (await res.json()) as { removed: number };
  return data.removed ?? 0;
}
