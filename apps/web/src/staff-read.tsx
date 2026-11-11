import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { staffError, staffQuery, type ServerEmployee } from "./staff-list";
import { ApiError, v1 } from "./v1";

type StaffPage = { items: ServerEmployee[]; total: number; limit: number; offset: number };

export function useStaffList(session: Session, enabled = true) {
  const [offset, setOffset] = useState(0);
  const [pass, setPass] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<ServerEmployee[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(25);
  const seen = useRef(false);

  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") setPass((value) => value + 1); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    seen.current = false;
    setItems([]);
    setTotal(0);
    setLoading(true);
    setError("");
  }, [session.token, session.tenantId, offset, enabled]);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let live = true;
    if (!seen.current) setLoading(true);
    void (async () => {
      try {
        const page = await v1<StaffPage>(session, staffQuery(offset));
        if (!live) return;
        setItems(page.items);
        setTotal(page.total);
        setLimit(page.limit);
        if (page.total > 0 && offset >= page.total) setOffset(Math.floor((page.total - 1) / page.limit) * page.limit);
        setError("");
        seen.current = true;
      } catch (reason) {
        if (!live) return;
        seen.current = false;
        setItems([]);
        setTotal(0);
        setError(staffError(reason instanceof ApiError ? reason.status : null));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [session.token, session.tenantId, offset, pass, enabled]);

  return { offset, setOffset, loading, error, items, total, limit, reload: () => setPass(value => value + 1) };
}

export function useStaffCard(session: Session, id: string | null, enabled = true) {
  const [pass, setPass] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [employee, setEmployee] = useState<ServerEmployee | null>(null);

  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") setPass((value) => value + 1); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    setEmployee(null);
    setError("");
    setLoading(Boolean(id));
  }, [session.token, session.tenantId, id, enabled]);

  useEffect(() => {
    if (!id || !enabled) return;
    let live = true;
    void (async () => {
      try {
        const row = await v1<ServerEmployee>(session, `/employees/${id}`);
        if (!live) return;
        setEmployee(row);
        setError("");
      } catch (reason) {
        if (!live) return;
        setEmployee(null);
        setError(staffError(reason instanceof ApiError ? reason.status : null, true));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [session.token, session.tenantId, id, pass, enabled]);

  return { loading, error, employee: employee?.id === id ? employee : null, reload: () => setPass(value => value + 1) };
}
