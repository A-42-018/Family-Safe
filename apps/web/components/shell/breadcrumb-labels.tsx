"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// Lets a page give an entity id a display name for the breadcrumb trail (e.g. child id → "Sam"). Purely presentational,
// client-side state: the name was already rendered by the server page, nothing is fetched or stored here.
interface Ctx { labels: Readonly<Record<string, string>>; setLabel: (id: string, name: string | null) => void }
const LabelsContext = createContext<Ctx>({ labels: {}, setLabel: () => {} });

export function BreadcrumbLabelsProvider({ children }: { children: React.ReactNode }) {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const setLabel = useCallback((id: string, name: string | null) => {
    setLabels((prev) => {
      if (name === null) {
        if (!(id in prev)) return prev;
        const rest = { ...prev };
        delete rest[id];
        return rest;
      }
      return prev[id] === name ? prev : { ...prev, [id]: name };
    });
  }, []);
  const value = useMemo(() => ({ labels, setLabel }), [labels, setLabel]);
  return <LabelsContext.Provider value={value}>{children}</LabelsContext.Provider>;
}

export const useBreadcrumbLabels = (): Readonly<Record<string, string>> => useContext(LabelsContext).labels;

/** Renders nothing; registers `name` for `id` while the page is mounted. */
export function BreadcrumbLabel({ id, name }: { id: string; name: string }) {
  const { setLabel } = useContext(LabelsContext);
  useEffect(() => {
    setLabel(id, name);
    return () => setLabel(id, null);
  }, [id, name, setLabel]);
  return null;
}
