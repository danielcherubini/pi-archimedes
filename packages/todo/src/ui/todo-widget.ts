import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { STATUS_ICONS } from "../types.js";
import type { TodoItem } from "../types.js";
import type { TodoStateManager } from "../state-manager.js";

const WIDGET_ID = "todo-list";

interface Column {
  header: string;
  todos: TodoItem[];
}

/**
 * Update (or clear) the todo widget.
 */
export function updateWidget(
  state: TodoStateManager,
  ctx: ExtensionContext,
  subagentTodos: Map<string, TodoItem[]>,
): void {
  const mainTodos = state.read();

  // Hide widget if everything is empty
  if (mainTodos.length === 0 && subagentTodos.size === 0) {
    ctx.ui.setWidget(WIDGET_ID, undefined);
    return;
  }

  ctx.ui.setWidget(WIDGET_ID, (_tui, theme) => {
    // Re-read in case state changed since widget was set
    const currentMain = state.read();
    const currentSub = new Map(subagentTodos);

    if (currentMain.length === 0 && currentSub.size === 0) {
      ctx.ui.setWidget(WIDGET_ID, undefined);
      return { render: () => [], invalidate: () => {} };
    }

    const currentStats = state.getStats();

    // Build columns
    const columns: Column[] = [];

    // Main column (always first, no header label)
    if (currentMain.length > 0) {
      columns.push({ header: "", todos: currentMain });
    }

    // Subagent columns (sorted by source name)
    const sortedSources = Array.from(currentSub.keys()).sort();
    for (const source of sortedSources) {
      const todos = currentSub.get(source)!;
      if (todos.length > 0) {
        // Per-child sources are subagent:<agent>:<uuid>; render only the agent
        // name so the header stays `subagent (myagent)` regardless of suffix.
        const agentName = source.replace("subagent:", "").split(":")[0];
        columns.push({ header: `subagent (${agentName})`, todos });
      }
    }

    if (columns.length === 0) {
      return { render: () => [], invalidate: () => {} };
    }

    const maxRows = Math.max(...columns.map((c) => c.todos.length));

    // When any column has a subagent header, reserve an extra row at the top
    // for the headers so todo[0] isn't overwritten by the header text.
    const hasSubHeader = columns.some((c) => c.header.length > 0);
    const headerRows = hasSubHeader ? 1 : 0;
    const totalRows = maxRows + headerRows;

    return {
      render(width: number) {
        const lines: string[] = [];

        // Header line
        const header =
          theme.fg("accent", " Todo List ") +
          theme.fg("muted", ` — ${currentStats.completed}/${currentStats.total} completed`);
        lines.push(truncateToWidth(header, width));

        // Calculate column widths
        const numCols = columns.length;
        const divider = theme.fg("dim", " │ ");
        const dividerWidth = numCols > 1 ? (numCols - 1) * visibleWidth(divider) : 0;
        const minColWidth = 20;
        let colWidth = numCols > 0 ? Math.floor((width - dividerWidth) / numCols) : width;
        colWidth = Math.max(colWidth, minColWidth);

        for (let row = 0; row < totalRows; row++) {
          const cellParts: string[] = [];

          for (const column of columns) {
            let cellText: string;

            if (row === 0 && headerRows > 0 && column.header) {
              // Header row for subagent columns
              cellText = ` ${column.header}`;
            } else {
              // Todo row — offset by the header row count
              const todoIndex = row - headerRows;
              if (todoIndex >= 0 && todoIndex < column.todos.length) {
                const todo = column.todos[todoIndex];
                if (todo) {
                  const icon = getStatusIcon(todo.status, theme);
                  const idStr = theme.fg("accent", `${todoIndex + 1}.`);
                  const title = formatTodoTitle(todo, theme);
                  cellText = ` ${icon} ${idStr} ${title}`;
                } else {
                  cellText = "";
                }
              } else {
                cellText = "";
              }
            }

            // Truncate and pad to column width
            const visible = visibleWidth(cellText);
            if (visible > colWidth) {
              // Truncate
              const truncated = truncateToWidth(cellText, colWidth);
              cellParts.push(truncated);
            } else {
              // Pad
              const padding = " ".repeat(colWidth - visible);
              cellParts.push(cellText + padding);
            }
          }

          // Join columns with dividers
          let line = cellParts.join(divider);
          lines.push(truncateToWidth(line, width));
        }

        return lines;
      },
      invalidate: () => {},
    };
  });
}

function getStatusIcon(status: TodoItem["status"], theme: Theme): string {
  const icon = STATUS_ICONS[status] ?? "?";
  if (status === "completed") return theme.fg("success", icon);
  if (status === "in_progress") return theme.fg("warning", icon.trim());
  return theme.fg("dim", icon);
}

function formatTodoTitle(todo: TodoItem, theme: Theme): string {
  if (todo.status === "completed") {
    return theme.fg("dim", theme.strikethrough(todo.content ?? ""));
  }
  if (todo.status === "in_progress") {
    return theme.fg("warning", todo.content ?? "");
  }
  return theme.fg("muted", todo.content ?? "");
}

/** Clear the widget */
export function clearWidget(ctx: ExtensionContext): void {
  ctx.ui.setWidget(WIDGET_ID, undefined);
}
