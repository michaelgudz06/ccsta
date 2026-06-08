import { useEffect, useState } from "react";

export type Role = "customer" | "driver" | "admin" | null;

const KEY = "fvb-mock-auth";

type Stored = { role: Role; email: string | null };

function read(): Stored {
  if (typeof window === "undefined") return { role: null, email: null };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { role: null, email: null };
    return JSON.parse(raw) as Stored;
  } catch {
    return { role: null, email: null };
  }
}

function write(value: Stored) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(value));
  window.dispatchEvent(new Event("fvb-auth-change"));
}

export function useAuth() {
  const [state, setState] = useState<Stored>({ role: null, email: null });

  useEffect(() => {
    setState(read());
    const handler = () => setState(read());
    window.addEventListener("fvb-auth-change", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("fvb-auth-change", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  return {
    role: state.role,
    email: state.email,
    login: (role: Exclude<Role, null>, email: string) => write({ role, email }),
    logout: () => write({ role: null, email: null }),
  };
}
