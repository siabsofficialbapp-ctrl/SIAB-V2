/**
 * The buyer's "save for later" list.
 *
 * Optimistic locally so the bookmark responds instantly, then reconciled
 * against the server.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import type { Product } from '@siab/core';

import { apiFetch } from '../lib/api';
import { useSession } from '../lib/session';

export function useSavedProducts() {
  const { session, role } = useSession();
  const enabled = Boolean(session) && role === 'buyer';
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const { data, refetch } = useQuery({
    queryKey: ['saved'],
    queryFn: () => apiFetch<{ products: Product[] }>('/saved'),
    enabled,
  });

  const savedIds = useMemo(() => {
    const ids = new Set((data?.products ?? []).map((p) => p.id));
    for (const [id, isSaved] of Object.entries(pending)) {
      if (isSaved) ids.add(id);
      else ids.delete(id);
    }
    return ids;
  }, [data, pending]);

  const toggleSave = useCallback(
    async (productId: string) => {
      const nextSaved = !savedIds.has(productId);
      setPending((p) => ({ ...p, [productId]: nextSaved }));
      try {
        await apiFetch(`/products/${productId}/save`, { method: nextSaved ? 'POST' : 'DELETE' });
        await refetch();
      } catch {
        // Put the bookmark back where it was.
        setPending((p) => ({ ...p, [productId]: !nextSaved }));
      }
    },
    [savedIds, refetch],
  );

  return { saved: data?.products ?? [], savedIds, toggleSave, refetch };
}
