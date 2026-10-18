// bb-plugin-lanes — a BB plugin frontend entry.
//
// Compiled by `bb plugin build` into dist/app.js + dist/app.css. React and
// @get-bb/plugin-sdk/app are provided by the BB app at load time (never bundled),
// so this file must be loaded by BB, not imported directly.
//
// The components under components/ui/ are YOURS: vendored source (shadcn
// model), edit freely. Add more from the BB registry with
// `npx shadcn add @bb/<name>` (see components.json) — dropdowns, tables,
// the full shadcn set, version-matched to this BB install. Run
// `npm install` once before `bb plugin build`.
import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Todo } from "./server";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** The todo list, kept current by the server's "todos-changed" signal. */
function useTodos() {
  const rpc = useRpc<typeof rpcContract>();
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);
  const refetch = useCallback(() => {
    rpc.call("todos_list").then((result) => {
      setTodos(result.todos);
      setError(null);
    }, report);
  }, [rpc, report]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  // server.ts publishes after every write — from this page, another window,
  // or `bb lanes add` run by an agent — so the list never goes stale.
  useRealtime("todos-changed", refetch);
  return { rpc, todos, error, report, refetch };
}

function TodoRow({
  todo,
  onToggle,
  onRemove,
}: {
  todo: Todo;
  onToggle: (done: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5 text-sm">
      <Checkbox
        checked={todo.done}
        onCheckedChange={(checked) => onToggle(checked === true)}
        aria-label={`Mark "${todo.title}" ${todo.done ? "not done" : "done"}`}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          todo.done && "text-muted-foreground line-through",
        )}
      >
        {todo.title}
      </span>
      <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
        {todo.id}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-foreground"
        aria-label={`Remove "${todo.title}"`}
        onClick={onRemove}
      >
        <Icon name="Trash2" className="size-4" />
      </Button>
    </li>
  );
}

/** The dashed box BB's own list pages use for loading and empty states. */
function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

// Tailwind classes compile against the host theme's live CSS variables —
// derive colors from the theme tokens, never hardcoded grays. The frame
// (scrolling page, centered column) matches BB's own nav-panel pages.
function TodosPage() {
  const { rpc, todos, error, report, refetch } = useTodos();
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = title.trim();
    if (next === "" || pending) return;
    setPending(true);
    try {
      await rpc.call("todos_add", { title: next });
      setTitle("");
      refetch();
    } catch (cause) {
      report(cause);
    } finally {
      setPending(false);
    }
  };
  const doneCount = todos?.filter((todo) => todo.done).length ?? 0;
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl px-4 pb-4 pt-3 md:px-5 md:pt-4">
        <p className="text-sm text-muted-foreground">
          Agents keep this list with <code>bb lanes</code>; the skill in{" "}
          <code>skills/example-todos</code> tells them how.
        </p>
        <form onSubmit={add} className="mt-4 flex items-center gap-2">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What needs doing?"
            aria-label="New todo"
          />
          <Button type="submit" disabled={pending || title.trim() === ""}>
            <Icon name="Plus" className="size-4" />
            Add
          </Button>
        </form>
        {error === null ? null : (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-4">
          {todos === null ? (
            <EmptyState>Loading todos…</EmptyState>
          ) : todos.length === 0 ? (
            <EmptyState>
              Nothing to do. Add one above, or run{" "}
              <code>bb lanes add "Ship it"</code>.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card px-4">
              {todos.map((todo) => (
                <TodoRow
                  key={todo.id}
                  todo={todo}
                  onToggle={(done) => {
                    rpc
                      .call("todos_set_done", { id: todo.id, done })
                      .then(refetch, report);
                  }}
                  onRemove={() => {
                    rpc
                      .call("todos_remove", { id: todo.id })
                      .then(refetch, report);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
        {todos !== null && todos.length > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {doneCount} of {todos.length} done
          </p>
        ) : null}
      </div>
    </div>
  );
}

// The default export must be definePluginApp(...); BB interprets it after
// loading the bundle. navPanel adds a page to the left sidebar; register
// other UI under app.slots and composer actions, plus-menu rows, banners, or
// rich-text rules with app.composer.customize(...) (see the bb guide's
// plugins chapter).
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "example-todos",
    title: "Example todos",
    icon: "ListTodo",
    // Routed at /plugins/lanes/example-todos; the component receives the
    // remainder as `subPath` for deep links within the page.
    path: "example-todos",
    component: TodosPage,
  });
});
