/**
 * useMediaLibrary — organization state for the media library (favorites,
 * collections, tags, trash). Wraps the `/api/media-library` endpoints with
 * optimistic local state so the UI stays responsive.
 *
 * Consumed by MediaLibrary.tsx and FileCard.tsx. Provides:
 * - favoritedPaths (Set) + toggleMediaFavorite
 * - collections + create/delete/update collection + add/remove item
 * - tags + assign/remove tags per item
 * - trash items + restore/purge/empty
 */
import { useCallback, useEffect, useState } from "react";
import {
  addItemToCollection,
  addItemTag,
  createCollection,
  createTag,
  deleteCollection,
  emptyTrash,
  listCollections,
  listItemCollections,
  listItemTags,
  listMediaFavorites,
  listTags,
  listTrash,
  moveItemToTrash,
  purgeFromTrash,
  removeItemFromCollection,
  removeItemTag,
  restoreFromTrash,
  setItemTags as setMediaItemTags,
  toggleMediaFavorite,
  updateCollection,
  type Collection,
  type Tag,
  type TrashItem,
} from "../../../services/api";

export interface MediaLibraryOrg {
  favorites: Set<string>;
  collections: Collection[];
  tags: Tag[];
  trash: TrashItem[];
  collectionsById: Map<string, Collection>;
  tagsById: Map<string, Tag>;
  itemCollections: Map<string, Collection[]>; // relative_path -> collections
  itemTags: Map<string, Tag[]>; // relative_path -> tags
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  // Actions
  toggleFavorite: (relativePath: string) => Promise<void>;
  isFavorite: (relativePath: string) => boolean;
  createCollection: (name: string, coverPath?: string | null) => Promise<Collection>;
  updateCollection: (collectionId: string, name: string, coverPath?: string | null) => Promise<Collection>;
  deleteCollection: (collectionId: string) => Promise<void>;
  addItemToCollection: (collectionId: string, relativePath: string) => Promise<void>;
  removeItemFromCollection: (collectionId: string, relativePath: string) => Promise<void>;
  loadItemCollections: (relativePath: string) => Promise<void>;
  createTag: (name: string, color?: string) => Promise<Tag>;
  addTagToItem: (relativePath: string, tagId: string) => Promise<void>;
  removeTagFromItem: (relativePath: string, tagId: string) => Promise<void>;
  setTagsForItem: (relativePath: string, tagIds: string[]) => Promise<void>;
  loadItemTags: (relativePath: string) => Promise<void>;
  moveToTrash: (relativePath: string, retentionDays?: number) => Promise<TrashItem>;
  restoreTrashItem: (relativePath: string) => Promise<void>;
  purgeTrashItem: (relativePath: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
}

export function useMediaLibrary(): MediaLibraryOrg {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [itemCollections, setItemCollections] = useState<
    Map<string, Collection[]>
  >(new Map());
  const [itemTags, setItemTags] = useState<Map<string, Tag[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const collectionsById = new Map(collections.map((c) => [c.id, c]));
  const tagsById = new Map(tags.map((t) => [t.id, t]));

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [favs, cols, tagsList, trashList] = await Promise.all([
        listMediaFavorites(),
        listCollections(),
        listTags(),
        listTrash(),
      ]);
      setFavorites(new Set(favs));
      setCollections(cols);
      setTags(tagsList);
      setTrash(trashList);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load library organization");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // ---------- Favorites ----------

  const toggleFavorite = useCallback(
    async (relativePath: string) => {
      const wasFav = favorites.has(relativePath);
      // Optimistic update
      setFavorites((prev) => {
        const next = new Set(prev);
        if (wasFav) next.delete(relativePath);
        else next.add(relativePath);
        return next;
      });
      try {
        const result = await toggleMediaFavorite(relativePath);
        if (result.favorited !== !wasFav) {
          // Server disagreed; revert
          setFavorites((prev) => {
            const next = new Set(prev);
            if (result.favorited) next.add(relativePath);
            else next.delete(relativePath);
            return next;
          });
        }
      } catch (e) {
        // Revert on error
        setFavorites((prev) => {
          const next = new Set(prev);
          if (wasFav) next.add(relativePath);
          else next.delete(relativePath);
          return next;
        });
        throw e;
      }
    },
    [favorites]
  );

  const isFavorite = useCallback(
    (relativePath: string) => favorites.has(relativePath),
    [favorites]
  );

  // ---------- Collections ----------

  const createNewCollection = useCallback(
    async (name: string, coverPath?: string | null) => {
      const created = await createCollection({ name, cover_path: coverPath });
      setCollections((prev) => [created, ...prev]);
      return created;
    },
    []
  );

  const updateExistingCollection = useCallback(
    async (collectionId: string, name: string, coverPath?: string | null) => {
      const updated = await updateCollection(collectionId, {
        name,
        cover_path: coverPath,
      });
      setCollections((prev) =>
        prev.map((c) => (c.id === collectionId ? updated : c))
      );
      return updated;
    },
    []
  );

  const deleteExistingCollection = useCallback(
    async (collectionId: string) => {
      await deleteCollection(collectionId);
      setCollections((prev) => prev.filter((c) => c.id !== collectionId));
    },
    []
  );

  const addItemToCollectionById = useCallback(
    async (collectionId: string, relativePath: string) => {
      await addItemToCollection(collectionId, relativePath);
      setItemCollections((prev) => {
        const next = new Map(prev);
        const items = next.get(relativePath) ?? [];
        if (!items.some((c) => c.id === collectionId)) {
          const coll = collectionsById.get(collectionId);
          if (coll) next.set(relativePath, [...items, coll]);
        }
        return next;
      });
    },
    [collectionsById]
  );

  const removeItemFromCollectionById = useCallback(
    async (collectionId: string, relativePath: string) => {
      await removeItemFromCollection(collectionId, relativePath);
      setItemCollections((prev) => {
        const next = new Map(prev);
        const items = next.get(relativePath);
        if (items) {
          next.set(
            relativePath,
            items.filter((c) => c.id !== collectionId)
          );
        }
        return next;
      });
    },
    []
  );

  const loadItemCollections = useCallback(
    async (relativePath: string) => {
      const items = await listItemCollections(relativePath);
      setItemCollections((prev) => {
        const next = new Map(prev);
        next.set(relativePath, items);
        return next;
      });
    },
    []
  );

  // ---------- Tags ----------

  const createNewTag = useCallback(
    async (name: string, color?: string) => {
      const created = await createTag({ name, color });
      setTags((prev) => [...prev, created]);
      return created;
    },
    []
  );

  const addTagToItemById = useCallback(
    async (relativePath: string, tagId: string) => {
      await addItemTag(relativePath, tagId);
      setItemTags((prev) => {
        const next = new Map(prev);
        const items = next.get(relativePath) ?? [];
        const tag = tagsById.get(tagId);
        if (tag && !items.some((t) => t.id === tagId)) {
          next.set(relativePath, [...items, tag]);
        }
        return next;
      });
    },
    [tagsById]
  );

  const removeTagFromItemById = useCallback(
    async (relativePath: string, tagId: string) => {
      await removeItemTag(relativePath, tagId);
      setItemTags((prev) => {
        const next = new Map(prev);
        const items = next.get(relativePath);
        if (items) {
          next.set(
            relativePath,
            items.filter((t) => t.id !== tagId)
          );
        }
        return next;
      });
    },
    []
  );

  const setTagsForItem = useCallback(
    async (relativePath: string, tagIds: string[]) => {
      await setMediaItemTags(relativePath, tagIds);
      const tagList = tags
        .filter((t) => tagIds.includes(t.id));
      setItemTags((prev) => {
        const next = new Map(prev);
        next.set(relativePath, tagList);
        return next;
      });
    },
    [tags]
  );

  const loadItemTags = useCallback(
    async (relativePath: string) => {
      const tagList = await listItemTags(relativePath);
      setItemTags((prev) => {
        const next = new Map(prev);
        next.set(relativePath, tagList);
        return next;
      });
    },
    []
  );

  // ---------- Trash ----------

  const moveToTrashByPath = useCallback(
    async (relativePath: string, retentionDays = 30) => {
      const trashed = await moveItemToTrash(relativePath, retentionDays);
      setTrash((prev) => [trashed, ...prev]);
      return trashed;
    },
    []
  );

  const restoreTrashItem = useCallback(
    async (relativePath: string) => {
      await restoreFromTrash(relativePath);
      setTrash((prev) => prev.filter((t) => t.relative_path !== relativePath));
    },
    []
  );

  const purgeTrashItem = useCallback(
    async (relativePath: string) => {
      await purgeFromTrash(relativePath);
      setTrash((prev) => prev.filter((t) => t.relative_path !== relativePath));
    },
    []
  );

  const emptyTrashAll = useCallback(async () => {
    await emptyTrash();
    setTrash([]);
  }, []);

  return {
    favorites,
    collections,
    tags,
    trash,
    collectionsById,
    tagsById,
    itemCollections,
    itemTags,
    loading,
    error,
    refetch,
    // actions
    toggleFavorite,
    isFavorite,
    createCollection: createNewCollection,
    updateCollection: updateExistingCollection,
    deleteCollection: deleteExistingCollection,
    addItemToCollection: addItemToCollectionById,
    removeItemFromCollection: removeItemFromCollectionById,
    loadItemCollections,
    createTag: createNewTag,
    addTagToItem: addTagToItemById,
    removeTagFromItem: removeTagFromItemById,
    setTagsForItem,
    loadItemTags,
    moveToTrash: moveToTrashByPath,
    restoreTrashItem,
    purgeTrashItem,
    emptyTrash: emptyTrashAll,
  };
}
