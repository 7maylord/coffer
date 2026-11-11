"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
  type ComponentProps,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  initialDemo,
  pages,
  type DemoState,
  type Activity,
  type PageId,
} from "@/lib/demo";
import type { OrganizationRole } from "@/lib/coffer-api";
import { Icon, Mark } from "./icon";

type DemoContext = {
  state: DemoState;
  setState: Dispatch<SetStateAction<DemoState>>;
  notify: (message: string) => void;
  record: (
    title: string,
    detail: string,
    category: Activity["category"],
  ) => void;
  href: (page: PageId) => string;
};
const Context = createContext<DemoContext | null>(null);
export function useDemo() {
  const context = useContext(Context);
  if (!context) throw new Error("Demo context missing");
  return context;
}
export function WorkspaceLink({
  page,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { page: PageId }) {
  const { href } = useDemo();
  return <Link href={href(page)} {...props} />;
}
export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-labelledby="modal-title"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
          ),
        );
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          const box = ref.current.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            close();
        }
      }}
    >
      <div className="modal-heading">
        <div>
          <span className="eyebrow">COFFER / WORKSPACE</span>
          <h2 id="modal-title">{title}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={`badge ${tone}`}>
      <span />
      {children}
    </span>
  );
}
export function Workspace({
  children,
  mode = "demo",
  organizationName,
  accountId,
  role,
  onLogout,
  visiblePages,
}: {
  children: ReactNode;
  mode?: "demo" | "authenticated";
  organizationName?: string;
  accountId?: string;
  role?: OrganizationRole;
  onLogout?: () => void;
  visiblePages?: ReadonlySet<PageId>;
}) {
  const [state, setState] = useState(() =>
    mode === "demo"
      ? initialDemo()
      : {
          workspace: organizationName ?? "NEAR workspace",
          reducedMotion: false,
          invoices: [],
          approvals: [],
          agents: [],
          activity: [],
        },
  );
  const [command, setCommand] = useState(false);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const basePath = mode === "demo" ? "/demo" : "";
  const href = (page: PageId) => `${basePath}/${page}`;
  const currentPage = pages.find((page) => pathname === href(page.id));
  const availablePages = pages.filter(
    (page) => !visiblePages || visiblePages.has(page.id),
  );
  const displayWorkspace =
    mode === "authenticated" && organizationName
      ? organizationName
      : state.workspace;
  const pending = state.approvals.filter(
    (item) => item.status === "Needs review",
  ).length;
  function notify(message: string) {
    toast.success(message);
  }
  function record(
    title: string,
    detail: string,
    category: Activity["category"],
  ) {
    setState((previous) => ({
      ...previous,
      activity: [
        { id: crypto.randomUUID(), title, detail, category, time: "Just now" },
        ...previous.activity,
      ].slice(0, 100),
    }));
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommand((open) => !open);
      }
      if (event.key === "Escape") setMenu(false);
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.motion = state.reducedMotion
      ? "reduced"
      : "full";
    return () => {
      delete document.documentElement.dataset.motion;
    };
  }, [state.reducedMotion]);
  return (
    <Context.Provider value={{ state, setState, notify, record, href }}>
      <div className="workspace">
        <a className="skip-link" href="#workspace-content">
          Skip to content
        </a>
        {menu && (
          <button
            className="sidebar-backdrop"
            aria-label="Close navigation"
            onClick={() => setMenu(false)}
          />
        )}
        <aside className={`sidebar ${menu ? "open" : ""}`}>
          <Link href="/" className="brand" aria-label="Coffer home">
            <Mark />
            coffer.
          </Link>
          <Link
            href={href("settings")}
            className="workspace-selector"
            onClick={() => setMenu(false)}
          >
            <span className="studio-avatar">f.</span>
            <span>
              {displayWorkspace}
              <small>
                {mode === "demo" ? "Sample workspace" : "Business workspace"}
              </small>
            </span>
            <Icon name="down" size={15} />
          </Link>
          <span className="nav-label">YOUR WORKSPACE</span>
          <nav aria-label="Workspace navigation">
            {availablePages
              .filter((page) => page.id !== "settings")
              .map((page, index) => (
                <Link
                  onClick={() => setMenu(false)}
                  href={href(page.id)}
                  key={page.id}
                  aria-current={
                    currentPage?.id === page.id ? "page" : undefined
                  }
                  className={`nav-item ${index === 4 ? "group-start" : ""}`}
                >
                  <Icon name={page.icon} size={19} />
                  <span>{page.label}</span>
                  {page.id === "approvals" && pending > 0 && (
                    <span className="nav-count">{pending}</span>
                  )}
                  {page.id === "cfo" && <span className="new-label">BETA</span>}
                </Link>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-note">
              <span className="asterisk">✳</span>
              <h3>
                A little space
                <br />
                for possibility.
              </h3>
              <p>
                Make yourself at home.
                <br />
                {mode === "demo"
                  ? "This sample workspace is yours to explore."
                  : "Signed in with a verified NEAR account."}
              </p>
              {availablePages.some((page) => page.id === "cfo") && (
                <Link href={href("cfo")} onClick={() => setMenu(false)}>
                  Meet your AI CFO <Icon name="arrow" size={16} />
                </Link>
              )}
            </div>
            {availablePages.some((page) => page.id === "settings") && (
              <Link
                href={href("settings")}
                className="nav-item"
                aria-current={
                  currentPage?.id === "settings" ? "page" : undefined
                }
                onClick={() => setMenu(false)}
              >
                <Icon name="settings" size={19} />
                Settings
              </Link>
            )}
            <button
              type="button"
              className="profile"
              onClick={
                mode === "authenticated"
                  ? onLogout
                  : () => {
                      router.push(href("settings"));
                      setMenu(false);
                    }
              }
            >
              <span className="avatar peach">
                {mode === "demo"
                  ? "JD"
                  : (accountId?.slice(0, 2).toUpperCase() ?? "NE")}
              </span>
              <span>
                {mode === "demo" ? "Jamie Davis" : accountId}
                <small>
                  {mode === "demo"
                    ? "Workspace owner"
                    : role?.toLowerCase().replaceAll("_", " ")}
                </small>
              </span>
              <Icon name={mode === "demo" ? "settings" : "logout"} size={17} />
              <span className="sr-only">
                {mode === "demo" ? "Open profile settings" : "Sign out"}
              </span>
            </button>
          </div>
        </aside>
        <div className="workspace-body">
          <header className="workspace-topbar">
            <div className="breadcrumb">
              <button
                className="icon-button mobile-toggle"
                aria-label="Open navigation"
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
              >
                <Icon name="menu" />
              </button>
              <span>{displayWorkspace}</span>
              <span className="slash">/</span>
              <strong>{currentPage?.label}</strong>
            </div>
            <div className="topbar-actions">
              <span className="demo-indicator">
                <span /> {mode === "demo" ? "SAMPLE DATA" : "SANDBOX"}
              </span>
              <button
                className="search-trigger"
                onClick={() => {
                  setQuery("");
                  setCommand(true);
                }}
                aria-label="Search workspace ⌘ K"
              >
                <Icon name="search" size={17} />
                <span>Search workspace</span>
                <kbd>⌘ K</kbd>
              </button>
              <Link
                href={href("activity")}
                className="icon-button notification-button"
                aria-label="View activity"
              >
                <Icon name="bell" />
                <i />
              </Link>
            </div>
          </header>
          <main
            id="workspace-content"
            tabIndex={-1}
            key={pathname}
            className="workspace-content"
          >
            {children}
          </main>
          <footer className="workspace-footer">
            <span>
              <span className="live-dot" /> A little more in sync.
            </span>
            <span>
              {mode === "demo"
                ? "Fictional records · No funds move"
                : "Simulated balances · Wallet approval required"}
            </span>
            <Link href={href("settings")}>
              About this workspace <Icon name="northeast" size={12} />
            </Link>
          </footer>
        </div>
        {command && (
          <Modal
            title="Where would you like to go?"
            close={() => setCommand(false)}
          >
            <label className="command-input">
              <Icon name="search" />
              <input
                autoFocus
                placeholder="Search pages…"
                aria-label="Search pages"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <kbd>ESC</kbd>
            </label>
            <div className="command-results">
              {availablePages
                .filter((page) =>
                  page.label.toLowerCase().includes(query.toLowerCase()),
                )
                .map((page) => (
                  <button
                    key={page.id}
                    onClick={() => {
                      router.push(href(page.id));
                      setCommand(false);
                    }}
                  >
                    <Icon name={page.icon} />
                    <span>{page.label}</span>
                    <Icon name="arrow" size={17} />
                  </button>
                ))}
              {!availablePages.some((page) =>
                page.label.toLowerCase().includes(query.toLowerCase()),
              ) && (
                <p className="empty-state">
                  No matching pages. Try “Treasury” or “Invoices”.
                </p>
              )}
            </div>
          </Modal>
        )}
      </div>
    </Context.Provider>
  );
}
