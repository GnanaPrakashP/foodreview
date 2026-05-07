"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { ChevronDown, ChevronRight, Download, RotateCcw } from "lucide-react";
import { circleTests, SECTIONS, SMOKE_TEST_IDS, type CircleTest, type Priority } from "@/lib/qa/circle-tests";

type TestStatus = "not_tested" | "pass" | "fail" | "na";
type FilterMode = "all" | "high" | "smoke" | "passed" | "failed" | "not_tested" | "na" | "section";

interface TestResult {
  status: TestStatus;
  notes: string;
  lastUpdated: string | null;
}

type ResultMap = Record<string, TestResult>;

const STORAGE_KEY = "fc_circle_qa_results_v1";

const FILTERS: Array<{ id: FilterMode; label: string }> = [
  { id: "all", label: "All" },
  { id: "high", label: "High priority" },
  { id: "smoke", label: "Smoke tests" },
  { id: "passed", label: "Passed" },
  { id: "failed", label: "Failed" },
  { id: "not_tested", label: "Not tested" },
  { id: "na", label: "N/A" },
  { id: "section", label: "By section" },
];

const STATUS_LABELS: Record<TestStatus, string> = {
  not_tested: "Not tested",
  pass: "PASS",
  fail: "FAIL",
  na: "N/A",
};

const PRIORITY_LABELS: Record<Priority, string> = {
  H: "High",
  M: "Medium",
  L: "Low",
};

function defaultResult(): TestResult {
  return { status: "not_tested", notes: "", lastUpdated: null };
}

function getResult(results: ResultMap, id: string): TestResult {
  return results[id] ?? defaultResult();
}

function formatDate(value: string | null): string {
  if (!value) return "Not updated";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function priorityColor(priority: Priority): string {
  if (priority === "H") return "var(--orange)";
  if (priority === "M") return "var(--gold)";
  return "var(--muted)";
}

function statusColor(status: TestStatus): string {
  if (status === "pass") return "var(--green)";
  if (status === "fail") return "#FF6B6B";
  if (status === "na") return "var(--gold)";
  return "var(--muted)";
}

function downloadFile(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildMarkdownExport(results: ResultMap): string {
  const lines = [
    "# Circle Manual QA Results",
    "",
    `Exported: ${new Date().toISOString()}`,
    "",
  ];

  for (const test of circleTests) {
    const result = getResult(results, test.id);
    lines.push(`## ${test.id} - ${test.title}`);
    lines.push("");
    lines.push(`- Section: ${test.section}`);
    lines.push(`- Priority: ${PRIORITY_LABELS[test.priority]}`);
    lines.push(`- Status: ${STATUS_LABELS[result.status]}`);
    lines.push(`- Last updated: ${result.lastUpdated ?? "Not updated"}`);
    lines.push(`- Notes: ${result.notes.trim() || "-"}`);
    lines.push("");
  }

  return lines.join("\n");
}

function TextBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: "6px" }}>
      <p
        style={{
          fontSize: "10px",
          fontWeight: 800,
          letterSpacing: "1px",
          textTransform: "uppercase",
          color: "var(--muted)",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        {label}
      </p>
      <div style={{ fontSize: "13px", lineHeight: 1.55, color: "var(--cream)" }}>{children}</div>
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        padding: "12px",
        minHeight: "72px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <span style={{ color: "var(--muted)", fontSize: "11px", fontWeight: 700 }}>{label}</span>
      <strong style={{ color: accent ?? "var(--cream)", fontFamily: "'Syne', sans-serif", fontSize: "21px" }}>
        {value}
      </strong>
    </div>
  );
}

function StatusButton({
  status,
  active,
  onClick,
}: {
  status: TestStatus;
  active: boolean;
  onClick: () => void;
}) {
  const color = statusColor(status);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: "34px",
        padding: "7px 11px",
        borderRadius: "8px",
        border: `1px solid ${active ? color : "var(--border)"}`,
        background: active ? `${color}22` : "var(--surface)",
        color: active ? color : "var(--muted)",
        fontSize: "11px",
        fontWeight: 800,
        cursor: "pointer",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {STATUS_LABELS[status]}
    </button>
  );
}

function TestCard({
  test,
  result,
  open,
  onToggle,
  onStatus,
  onNotes,
}: {
  test: CircleTest;
  result: TestResult;
  open: boolean;
  onToggle: () => void;
  onStatus: (status: TestStatus) => void;
  onNotes: (notes: string) => void;
}) {
  const failed = result.status === "fail";
  const high = test.priority === "H";

  return (
    <article
      style={{
        background: "var(--card)",
        border: `1px solid ${failed ? "#FF6B6B" : high ? "rgba(240,96,48,0.45)" : "var(--border)"}`,
        borderRadius: "8px",
        boxShadow: failed ? "0 0 0 1px rgba(255,107,107,0.18)" : "none",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          background: high ? "linear-gradient(90deg, rgba(240,96,48,0.12), transparent)" : "transparent",
          border: "none",
          padding: "13px 14px",
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: "12px",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "7px" }}>
            <span style={{ color: "var(--orange)", fontSize: "11px", fontWeight: 900, letterSpacing: "0.6px" }}>
              {test.id}
            </span>
            <span
              style={{
                color: priorityColor(test.priority),
                fontSize: "10px",
                fontWeight: 900,
                border: `1px solid ${priorityColor(test.priority)}55`,
                borderRadius: "999px",
                padding: "3px 7px",
              }}
            >
              {PRIORITY_LABELS[test.priority]}
            </span>
            {SMOKE_TEST_IDS.has(test.id) && (
              <span
                style={{
                  color: "var(--gold)",
                  fontSize: "10px",
                  fontWeight: 900,
                  border: "1px solid rgba(232,168,48,0.35)",
                  borderRadius: "999px",
                  padding: "3px 7px",
                }}
              >
                Smoke
              </span>
            )}
            <span style={{ color: statusColor(result.status), fontSize: "10px", fontWeight: 900 }}>
              {STATUS_LABELS[result.status]}
            </span>
          </div>
          <h2
            style={{
              color: "var(--cream)",
              fontSize: "15px",
              lineHeight: 1.25,
              fontWeight: 800,
              fontFamily: "'Syne', sans-serif",
            }}
          >
            {test.title}
          </h2>
          <p style={{ color: "var(--muted)", fontSize: "11px", marginTop: "5px" }}>{test.section}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", color: "var(--muted)" }}>
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </div>
      </button>

      {open && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "14px", display: "grid", gap: "15px" }}>
          <TextBlock label="Preconditions">{test.preconditions}</TextBlock>

          <TextBlock label="Steps">
            <ol style={{ margin: 0, paddingLeft: "18px", display: "grid", gap: "5px" }}>
              {test.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </TextBlock>

          <TextBlock label="Expected UI Result">{test.expectedUI}</TextBlock>
          <TextBlock label="Expected Backend / Database State">{test.expectedBackend}</TextBlock>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <StatusButton status="pass" active={result.status === "pass"} onClick={() => onStatus("pass")} />
            <StatusButton status="fail" active={result.status === "fail"} onClick={() => onStatus("fail")} />
            <StatusButton status="na" active={result.status === "na"} onClick={() => onStatus("na")} />
            <StatusButton
              status="not_tested"
              active={result.status === "not_tested"}
              onClick={() => onStatus("not_tested")}
            />
          </div>

          <label style={{ display: "grid", gap: "7px" }}>
            <span style={{ color: "var(--muted)", fontSize: "11px", fontWeight: 800 }}>Notes</span>
            <textarea
              value={result.notes}
              onChange={(event) => onNotes(event.target.value)}
              placeholder="What happened during this run?"
              rows={3}
              style={{
                width: "100%",
                resize: "vertical",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                color: "var(--cream)",
                padding: "10px 12px",
                outline: "none",
                fontSize: "13px",
                lineHeight: 1.45,
                fontFamily: "'DM Sans', sans-serif",
              }}
            />
          </label>

          <p style={{ color: "var(--muted)", fontSize: "10px", textAlign: "right" }}>
            Last updated: {formatDate(result.lastUpdated)}
          </p>
        </div>
      )}
    </article>
  );
}

export default function CircleQaClient() {
  const [results, setResults] = useState<ResultMap>({});
  const [filter, setFilter] = useState<FilterMode>("all");
  const [section, setSection] = useState<string>(SECTIONS[0]);
  const [openCards, setOpenCards] = useState<Set<string>>(new Set(["CIR-001"]));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setResults(JSON.parse(stored));
    } catch {
      setResults({});
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
  }, [loaded, results]);

  const summary = useMemo(() => {
    const counts = { total: circleTests.length, pass: 0, fail: 0, na: 0, notTested: 0 };
    for (const test of circleTests) {
      const status = getResult(results, test.id).status;
      if (status === "pass") counts.pass += 1;
      else if (status === "fail") counts.fail += 1;
      else if (status === "na") counts.na += 1;
      else counts.notTested += 1;
    }
    const tested = counts.pass + counts.fail + counts.na;
    return { ...counts, completion: Math.round((tested / counts.total) * 100) };
  }, [results]);

  const visibleTests = useMemo(() => {
    return circleTests.filter((test) => {
      const status = getResult(results, test.id).status;
      if (filter === "high") return test.priority === "H";
      if (filter === "smoke") return SMOKE_TEST_IDS.has(test.id);
      if (filter === "passed") return status === "pass";
      if (filter === "failed") return status === "fail";
      if (filter === "not_tested") return status === "not_tested";
      if (filter === "na") return status === "na";
      if (filter === "section") return test.section === section;
      return true;
    });
  }, [filter, results, section]);

  function updateResult(id: string, patch: Partial<TestResult>) {
    setResults((prev) => {
      const current = getResult(prev, id);
      return {
        ...prev,
        [id]: {
          ...current,
          ...patch,
          lastUpdated: new Date().toISOString(),
        },
      };
    });
  }

  function resetAll() {
    const ok = window.confirm("Reset all Circle QA results and notes?");
    if (!ok) return;
    setResults({});
    window.localStorage.removeItem(STORAGE_KEY);
  }

  function exportJson() {
    const payload = {
      exportedAt: new Date().toISOString(),
      storageKey: STORAGE_KEY,
      summary,
      results: circleTests.map((test) => ({
        id: test.id,
        title: test.title,
        priority: PRIORITY_LABELS[test.priority],
        section: test.section,
        smoke: SMOKE_TEST_IDS.has(test.id),
        ...getResult(results, test.id),
      })),
    };
    downloadFile("circle-qa-results.json", JSON.stringify(payload, null, 2), "application/json");
  }

  function exportMarkdown() {
    downloadFile("circle-qa-results.md", buildMarkdownExport(results), "text/markdown");
  }

  function toggleOpen(id: string) {
    setOpenCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", padding: "18px 14px 24px" }}>
      <header style={{ display: "grid", gap: "10px", marginBottom: "16px" }}>
        <div>
          <p
            style={{
              color: "var(--orange)",
              fontSize: "10px",
              fontWeight: 900,
              letterSpacing: "1.8px",
              textTransform: "uppercase",
              marginBottom: "5px",
            }}
          >
            Internal QA
          </p>
          <h1 style={{ color: "var(--cream)", fontFamily: "'Syne', sans-serif", fontSize: "24px", fontWeight: 800 }}>
            Circle manual checklist
          </h1>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={exportJson}
            style={actionButtonStyle}
          >
            <Download size={14} />
            JSON
          </button>
          <button
            type="button"
            onClick={exportMarkdown}
            style={actionButtonStyle}
          >
            <Download size={14} />
            Markdown
          </button>
          <button
            type="button"
            onClick={resetAll}
            style={{ ...actionButtonStyle, color: "#FF6B6B" }}
          >
            <RotateCcw size={14} />
            Reset
          </button>
        </div>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: "8px",
          marginBottom: "14px",
        }}
      >
        <StatTile label="Total" value={String(summary.total)} />
        <StatTile label="Completion" value={`${summary.completion}%`} accent="var(--gold)" />
        <StatTile label="Passed" value={String(summary.pass)} accent="var(--green)" />
        <StatTile label="Failed" value={String(summary.fail)} accent="#FF6B6B" />
        <StatTile label="Not tested" value={String(summary.notTested)} />
        <StatTile label="N/A" value={String(summary.na)} accent="var(--gold)" />
      </section>

      <section style={{ display: "grid", gap: "10px", marginBottom: "14px" }}>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {FILTERS.map((item) => {
            const active = filter === item.id;
            return (
              <button
                type="button"
                key={item.id}
                onClick={() => setFilter(item.id)}
                style={{
                  minHeight: "34px",
                  borderRadius: "999px",
                  padding: "7px 11px",
                  border: `1px solid ${active ? "var(--orange)" : "var(--border)"}`,
                  background: active ? "var(--orange-dim)" : "var(--surface)",
                  color: active ? "var(--orange)" : "var(--muted)",
                  fontSize: "11px",
                  fontWeight: 800,
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {filter === "section" && (
          <select
            value={section}
            onChange={(event) => setSection(event.target.value)}
            style={{
              width: "100%",
              minHeight: "40px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--cream)",
              padding: "0 10px",
              fontSize: "13px",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {SECTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        )}

        <p style={{ color: "var(--muted)", fontSize: "11px" }}>
          Showing {visibleTests.length} of {circleTests.length} tests
        </p>
      </section>

      <section style={{ display: "grid", gap: "10px" }}>
        {visibleTests.length === 0 ? (
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "20px",
              color: "var(--muted)",
              textAlign: "center",
              fontSize: "13px",
            }}
          >
            No tests match this filter.
          </div>
        ) : (
          visibleTests.map((test) => (
            <TestCard
              key={test.id}
              test={test}
              result={getResult(results, test.id)}
              open={openCards.has(test.id)}
              onToggle={() => toggleOpen(test.id)}
              onStatus={(status) => updateResult(test.id, { status })}
              onNotes={(notes) => updateResult(test.id, { notes })}
            />
          ))
        )}
      </section>
    </div>
  );
}

const actionButtonStyle: CSSProperties = {
  minHeight: "36px",
  display: "inline-flex",
  alignItems: "center",
  gap: "7px",
  borderRadius: "8px",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--cream)",
  padding: "8px 10px",
  fontSize: "12px",
  fontWeight: 800,
  cursor: "pointer",
  fontFamily: "'DM Sans', sans-serif",
};
