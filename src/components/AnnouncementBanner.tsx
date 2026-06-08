import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";

const KEY = "fvb-banner-dismissed";

export function AnnouncementBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setShow(window.localStorage.getItem(KEY) !== "1");
  }, []);
  if (!show) return null;
  return (
    <div className="relative bg-primary text-primary-foreground">
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-3 px-4 py-2 text-center text-xs sm:text-sm">
        <span>
          We have moved to online booking. Get an instant estimate in minutes.{" "}
          <Link to="/login" className="font-semibold underline underline-offset-2 hover:text-accent">
            Create an account
          </Link>
          .
        </span>
        <button
          onClick={() => {
            window.localStorage.setItem(KEY, "1");
            setShow(false);
          }}
          aria-label="Dismiss"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-primary-foreground/10"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
