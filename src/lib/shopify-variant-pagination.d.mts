export function collectCompleteVariantEdges<T>(
  initialConnection: {
    edges: T[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  },
  fetchNextPage: (cursor: string) => Promise<{
    edges: T[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  }>,
  expectedCount?: number | null,
): Promise<T[]>;
