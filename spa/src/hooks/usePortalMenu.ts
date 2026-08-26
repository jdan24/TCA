/**
 * usePortalMenu — dropdown menu state for a menu rendered into a portal.
 *
 * Menus in this app render into document.body at a fixed position rather than
 * absolutely inside their container: the cards they live in are overflow-hidden
 * for their rounded corners, which clipped an absolutely-positioned menu to the
 * card's height. A fixed-position portal anchored to the button escapes every
 * ancestor.
 *
 * Dismissal covers outside click, Escape, and anything that moves the anchor
 * (scroll or resize) — repositioning would drift out of sync with the button,
 * so the menu just closes.
 *
 * The one subtlety, and the reason this is shared rather than copy-pasted: the
 * scroll listener is registered in the capture phase, so it also sees scrolls
 * that happen *inside* the menu. A menu tall enough to need its own scrollbar
 * would close the instant you dragged it, making its lower entries unreachable.
 * Scrolls originating within the menu are therefore ignored.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Fixed-position coordinates, anchored to whichever edge the menu aligns to. */
export type PortalMenuPos =
  | { top: number; left: number; right?: undefined }
  | { top: number; right: number; left?: undefined };

export interface UsePortalMenuReturn {
  open: boolean;
  /** Attach to the trigger button. */
  btnRef: React.RefObject<HTMLButtonElement | null>;
  /** Attach to the portal'd menu container. */
  menuRef: React.RefObject<HTMLDivElement | null>;
  /** null until the menu has been opened and the anchor measured. */
  pos: PortalMenuPos | null;
  /** Open when closed, close when open — wire to the button's onClick. */
  toggle: () => void;
  close: () => void;
}

export function usePortalMenu(align: "left" | "right" = "left"): UsePortalMenuReturn {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PortalMenuPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      if (wasOpen) return false;
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return false;
      setPos(
        align === "right"
          ? { top: rect.bottom + 4, right: window.innerWidth - rect.right }
          : { top: rect.bottom + 4, left: rect.left },
      );
      return true;
    });
  }, [align]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (btnRef.current?.contains(target)) return; // the button toggles itself
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReflow = (e: Event) => {
      // Scrolling the menu's own list must not dismiss it — see the note above.
      const target = e.target as Node | null;
      if (target !== null && menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open]);

  return { open, btnRef, menuRef, pos, toggle, close };
}
