"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, Database, Download, ExternalLink, RotateCcw, Terminal, XCircle } from "lucide-react";
import { manualQaSections, manualQaSmokeIds, manualQaTests, type ManualQaPriority, type ManualQaTest } from "@/lib/qa/manual-tests";

type QaStatus = "not_tested" | "pass" | "fail" | "na";
type Filter = "all" | "smoke" | "p0" | "failed" | "not_tested" | "section";
type QaView = "manual" | "automated" | "e2e" | "supabase";

interface QaResult {
  status: QaStatus;
  notes: string;
  updatedAt: string | null;
}

type QaResultMap = Record<string, QaResult>;

const STORAGE_KEY = "fc_manual_qa_results_v1";

const views: Array<{ id: QaView; label: string }> = [
  { id: "manual", label: "Manual" },
  { id: "automated", label: "Automated" },
  { id: "e2e", label: "E2E" },
  { id: "supabase", label: "Live Supabase" },
];

const statusLabels: Record<QaStatus, string> = {
  not_tested: "Not tested",
  pass: "Pass",
  fail: "Fail",
  na: "N/A",
};

const filters: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "smoke", label: "Smoke" },
  { id: "p0", label: "P0" },
  { id: "failed", label: "Failed" },
  { id: "not_tested", label: "Not tested" },
  { id: "section", label: "Section" },
];

const automatedChecks = [
  {
    title: "Node/API/security tests",
    command: "npm test",
    detail: "Runs the node:test suite for API routes, auth, visibility, notifications, Circle, schema/RLS guards, and QA checklist guards.",
  },
  {
    title: "Coverage summary",
    command: "npm run test:coverage",
    detail: "Generates terminal c8 coverage. React pages stay low in c8 because they are covered by E2E/manual instead.",
  },
  {
    title: "HTML coverage report",
    command: "npm run test:coverage:html",
    detail: "Writes the browsable report to coverage/index.html.",
  },
  {
    title: "Production build",
    command: "npm run build",
    detail: "Checks TypeScript, Next build, static generation, and route compilation.",
  },
];

const e2eChecks = [
  {
    title: "Seed E2E data",
    command: "node scripts/seed-e2e.mjs",
    detail: "Creates/repairs E2E users, reviews, account types, and Circle relationships.",
  },
  {
    title: "Full E2E suite",
    command: "node scripts/seed-e2e.mjs && npm run test:e2e -- --workers=1",
    detail: "Recommended full go-live browser pass. Serial workers reduce flake from shared seeded users.",
  },
  {
    title: "Desktop smoke only",
    command: "npm run test:e2e -- e2e/batch4-smoke.spec.ts --project=chromium --workers=1",
    detail: "Desktop launch smoke for auth, reviews, visibility, Circle, notifications, trending, and common badge.",
  },
  {
    title: "Mobile smoke only",
    command: "npm run test:e2e -- --project=mobile --workers=1",
    detail: "Mobile-focused pass for login, bottom nav, review form, Circle, notifications, search, trending, and layout overflow.",
  },
  {
    title: "Open Playwright report",
    command: "npx playwright show-report",
    detail: "Use this after failures to inspect screenshots, traces, and videos.",
  },
];

const supabaseChecks = [
  {
    title: "Apply safe migrations to existing DB",
    command: "npx supabase db push",
    detail: "Use migrations for existing/local/staging/prod DBs. Do not run schema.sql on a DB with data.",
  },
  {
    title: "Verify required tables/columns",
    command: `select
  to_regclass('public.circle_memberships') as circle_memberships,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'account_type'
  ) as profiles_account_type;`,
    detail: "Both values should confirm the migration is present.",
  },
  {
    title: "Verify privacy policies",
    command: `select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('reviews', 'comments', 'likes', 'wishlist', 'circle_memberships')
order by tablename, policyname;`,
    detail: "Expected policies include Reviews readable by visibility, Comments/Likes readable by visible review, Wishlist readable by owner.",
  },
  {
    title: "Old open read policies must be absent",
    command: `select tablename, policyname
from pg_policies
where schemaname = 'public'
  and policyname in (
    'Reviews are readable by everyone',
    'Comments readable by everyone',
    'Likes readable by everyone',
    'Wishlist readable by everyone'
  );`,
    detail: "This query should return zero rows.",
  },
  {
    title: "New empty DB baseline",
    command: "Run supabase/schema.sql only on a fresh empty DB or reset DB.",
    detail: "schema.sql still has destructive setup at the top, so never run it against existing data.",
  },
];

function defaultResult(): QaResult {
  return { status: "not_tested", notes: "", updatedAt: null };
}

function getResult(results: QaResultMap, id: string): QaResult {
  return results[id] ?? defaultResult();
}

function statusColor(status: QaStatus) {
  if (status === "pass") return "var(--green)";
  if (status === "fail") return "#FF6B6B";
  if (status === "na") return "var(--gold)";
  return "var(--muted)";
}

function priorityColor(priority: ManualQaPriority) {
  if (priority === "P0") return "var(--orange)";
  if (priority === "P1") return "var(--gold)";
  return "var(--muted)";
}

function formatDate(value: string | null) {
  if (!value) return "Not updated";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
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

function buildMarkdown(results: QaResultMap) {
  const lines = ["# CircleBites Manual QA Results", "", `Exported: ${new Date().toISOString()}`, ""];

  for (const test of manualQaTests) {
    const result = getResult(results, test.id);
    lines.push(`## ${test.id} - ${test.title}`);
    lines.push("");
    lines.push(`- Section: ${test.section}`);
    lines.push(`- Priority: ${test.priority}`);
    lines.push(`- Route: ${test.route}`);
    lines.push(`- Smoke: ${manualQaSmokeIds.has(test.id) ? "yes" : "no"}`);
    lines.push(`- Status: ${statusLabels[result.status]}`);
    lines.push(`- Updated: ${result.updatedAt ?? "Not updated"}`);
    lines.push(`- Notes: ${result.notes.trim() || "-"}`);
    lines.push("");
  }

  return lines.join("\n");
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      style={{
        minHeight: "74px",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        background: "var(--card)",
        padding: "12px",
        display: "grid",
        alignContent: "space-between",
      }}
    >
      <span style={{ color: "var(--muted)", fontSize: "11px", fontWeight: 800 }}>{label}</span>
      <strong style={{ color: accent ?? "var(--cream)", fontFamily: "'Syne', sans-serif", fontSize: "22px" }}>
        {value}
      </strong>
    </div>
  );
}

function CommandCard({ title, command, detail }: { title: string; command: string; detail: string }) {
  return (
    <article
      style={{
        border: "1px solid var(--border)",
        borderRadius: "8px",
        background: "var(--card)",
        padding: "14px",
        display: "grid",
        gap: "10px",
      }}
    >
      <h2 style={{ color: "var(--cream)", fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 800 }}>
        {title}
      </h2>
      <pre
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          borderRadius: "8px",
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--cream)",
          padding: "11px",
          fontSize: "12px",
          lineHeight: 1.5,
        }}
      >
        <code>{command}</code>
      </pre>
      <p style={bodyStyle}>{detail}</p>
    </article>
  );
}

function CommandSection({
  eyebrow,
  title,
  description,
  checks,
}: {
  eyebrow: string;
  title: string;
  description: string;
  checks: Array<{ title: string; command: string; detail: string }>;
}) {
  return (
    <section style={{ display: "grid", gap: "12px" }}>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "8px",
          background: "var(--card)",
          padding: "14px",
          display: "grid",
          gap: "7px",
        }}
      >
        <p style={labelStyle}>{eyebrow}</p>
        <h2 style={{ color: "var(--cream)", fontFamily: "'Syne', sans-serif", fontSize: "18px", fontWeight: 800 }}>
          {title}
        </h2>
        <p style={bodyStyle}>{description}</p>
      </div>
      {checks.map((check) => (
        <CommandCard key={check.title} {...check} />
      ))}
    </section>
  );
}

function StatusButton({
  status,
  active,
  onClick,
}: {
  status: QaStatus;
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
        borderRadius: "8px",
        border: `1px solid ${active ? color : "var(--border)"}`,
        background: active ? `${color}22` : "var(--surface)",
        color: active ? color : "var(--muted)",
        padding: "7px 10px",
        fontSize: "11px",
        fontWeight: 900,
        cursor: "pointer",
      }}
    >
      {statusLabels[status]}
    </button>
  );
}

function TestCard({
  test,
  result,
  onStatus,
  onNotes,
}: {
  test: ManualQaTest;
  result: QaResult;
  onStatus: (status: QaStatus) => void;
  onNotes: (notes: string) => void;
}) {
  const routeIsPath = test.route.startsWith("/");

  return (
    <article
      style={{
        border: `1px solid ${result.status === "fail" ? "#FF6B6B" : "var(--border)"}`,
        borderRadius: "8px",
        background: "var(--card)",
        padding: "14px",
        display: "grid",
        gap: "12px",
      }}
    >
      <header style={{ display: "grid", gap: "8px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", alignItems: "center" }}>
          <span style={{ color: "var(--orange)", fontSize: "11px", fontWeight: 900 }}>{test.id}</span>
          <span
            style={{
              color: priorityColor(test.priority),
              border: `1px solid ${priorityColor(test.priority)}66`,
              borderRadius: "999px",
              padding: "3px 7px",
              fontSize: "10px",
              fontWeight: 900,
            }}
          >
            {test.priority}
          </span>
          {manualQaSmokeIds.has(test.id) && (
            <span
              style={{
                color: "var(--gold)",
                border: "1px solid rgba(232,168,48,0.45)",
                borderRadius: "999px",
                padding: "3px 7px",
                fontSize: "10px",
                fontWeight: 900,
              }}
            >
              Smoke
            </span>
          )}
          <span style={{ color: statusColor(result.status), fontSize: "10px", fontWeight: 900 }}>
            {statusLabels[result.status]}
          </span>
        </div>

        <h2 style={{ color: "var(--cream)", fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 800 }}>
          {test.title}
        </h2>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
          <span style={{ color: "var(--muted)", fontSize: "11px", fontWeight: 700 }}>{test.section}</span>
          {routeIsPath ? (
            <a href={test.route} style={linkStyle}>
              {test.route}
              <ExternalLink size={13} />
            </a>
          ) : (
            <span style={{ color: "var(--muted)", fontSize: "11px" }}>{test.route}</span>
          )}
        </div>
      </header>

      <section style={{ display: "grid", gap: "8px" }}>
        <p style={labelStyle}>Steps</p>
        <ol style={{ margin: 0, paddingLeft: "18px", color: "var(--cream)", fontSize: "13px", lineHeight: 1.55 }}>
          {test.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section style={{ display: "grid", gap: "6px" }}>
        <p style={labelStyle}>Expected</p>
        <p style={bodyStyle}>{test.expected}</p>
      </section>

      <section style={{ display: "grid", gap: "6px" }}>
        <p style={labelStyle}>Automated coverage</p>
        <p style={bodyStyle}>{test.automatedCoverage}</p>
      </section>

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
        <span style={labelStyle}>Notes</span>
        <textarea
          value={result.notes}
          onChange={(event) => onNotes(event.target.value)}
          rows={3}
          placeholder="Record what happened during this run."
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
          }}
        />
      </label>

      <p style={{ color: "var(--muted)", fontSize: "10px", textAlign: "right" }}>
        Last updated: {formatDate(result.updatedAt)}
      </p>
    </article>
  );
}

const labelStyle = {
  color: "var(--muted)",
  fontSize: "10px",
  fontWeight: 900,
  letterSpacing: "1px",
  textTransform: "uppercase",
} as const;

const bodyStyle = {
  color: "var(--cream)",
  fontSize: "13px",
  lineHeight: 1.55,
} as const;

const linkStyle = {
  color: "var(--orange)",
  fontSize: "11px",
  fontWeight: 800,
  display: "inline-flex",
  gap: "4px",
  alignItems: "center",
  textDecoration: "none",
} as const;

const actionButtonStyle = {
  minHeight: "36px",
  borderRadius: "8px",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--cream)",
  padding: "8px 11px",
  fontSize: "12px",
  fontWeight: 800,
  display: "inline-flex",
  alignItems: "center",
  gap: "7px",
  cursor: "pointer",
} as const;

export default function ManualQaClient() {
  const [results, setResults] = useState<QaResultMap>({});
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [section, setSection] = useState(manualQaSections[0]);
  const [view, setView] = useState<QaView>("manual");

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
    const counts = { total: manualQaTests.length, pass: 0, fail: 0, na: 0, notTested: 0 };
    for (const test of manualQaTests) {
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
    return manualQaTests.filter((test) => {
      const status = getResult(results, test.id).status;
      if (filter === "smoke") return manualQaSmokeIds.has(test.id);
      if (filter === "p0") return test.priority === "P0";
      if (filter === "failed") return status === "fail";
      if (filter === "not_tested") return status === "not_tested";
      if (filter === "section") return test.section === section;
      return true;
    });
  }, [filter, results, section]);

  function updateResult(id: string, patch: Partial<QaResult>) {
    setResults((prev) => ({
      ...prev,
      [id]: {
        ...getResult(prev, id),
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    }));
  }

  function resetAll() {
    const ok = window.confirm("Reset all manual QA results and notes?");
    if (!ok) return;
    setResults({});
    window.localStorage.removeItem(STORAGE_KEY);
  }

  function exportJson() {
    const payload = {
      exportedAt: new Date().toISOString(),
      storageKey: STORAGE_KEY,
      summary,
      results: manualQaTests.map((test) => ({
        ...test,
        smoke: manualQaSmokeIds.has(test.id),
        ...getResult(results, test.id),
      })),
    };
    downloadFile("manual-qa-results.json", JSON.stringify(payload, null, 2), "application/json");
  }

  function exportMarkdown() {
    downloadFile("manual-qa-results.md", buildMarkdown(results), "text/markdown");
  }

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", padding: "18px 14px 28px" }}>
      <header style={{ display: "grid", gap: "12px", marginBottom: "16px" }}>
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
          <h1 style={{ color: "var(--cream)", fontFamily: "'Syne', sans-serif", fontSize: "25px", fontWeight: 800 }}>
            Go-live QA dashboard
          </h1>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <a href="/qa/circle" style={actionButtonStyle}>
            <Circle size={14} />
            Circle QA
          </a>
          <button type="button" onClick={exportJson} style={actionButtonStyle}>
            <Download size={14} />
            JSON
          </button>
          <button type="button" onClick={exportMarkdown} style={actionButtonStyle}>
            <Download size={14} />
            Markdown
          </button>
          <button type="button" onClick={resetAll} style={{ ...actionButtonStyle, color: "#FF6B6B" }}>
            <RotateCcw size={14} />
            Reset
          </button>
        </div>
      </header>

      <section style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }}>
        {views.map((item) => {
          const active = view === item.id;
          return (
            <button
              type="button"
              key={item.id}
              onClick={() => setView(item.id)}
              style={{
                minHeight: "38px",
                borderRadius: "8px",
                border: `1px solid ${active ? "var(--orange)" : "var(--border)"}`,
                background: active ? "var(--orange-dim)" : "var(--surface)",
                color: active ? "var(--orange)" : "var(--muted)",
                padding: "8px 12px",
                fontSize: "12px",
                fontWeight: 900,
                cursor: "pointer",
                display: "inline-flex",
                gap: "7px",
                alignItems: "center",
              }}
            >
              {item.id === "automated" && <Terminal size={14} />}
              {item.id === "supabase" && <Database size={14} />}
              {item.id === "manual" && <CheckCircle2 size={14} />}
              {item.id === "e2e" && <Circle size={14} />}
              {item.label}
            </button>
          );
        })}
      </section>

      {view === "automated" && (
        <CommandSection
          eyebrow="Automated tests"
          title="Run these before every go-live candidate"
          description="These commands verify the Node/API/security suite, coverage report, and production build."
          checks={automatedChecks}
        />
      )}

      {view === "e2e" && (
        <CommandSection
          eyebrow="Browser E2E"
          title="Seed users, then run desktop and mobile smoke"
          description="Use the full serial command as the final browser automation gate. The smaller commands are useful when debugging."
          checks={e2eChecks}
        />
      )}

      {view === "supabase" && (
        <CommandSection
          eyebrow="Live Supabase verification"
          title="Confirm the actual target database is safe"
          description="Run these against the database you will deploy with. Passing local tests is not enough if production policies were not applied."
          checks={supabaseChecks}
        />
      )}

      {view === "manual" && (
        <>
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "8px",
              marginBottom: "14px",
            }}
          >
            <Stat label="Total" value={String(summary.total)} />
            <Stat label="Completion" value={`${summary.completion}%`} accent="var(--gold)" />
            <Stat label="Passed" value={String(summary.pass)} accent="var(--green)" />
            <Stat label="Failed" value={String(summary.fail)} accent="#FF6B6B" />
            <Stat label="Not tested" value={String(summary.notTested)} />
            <Stat label="N/A" value={String(summary.na)} accent="var(--gold)" />
          </section>

          <section style={{ display: "grid", gap: "10px", marginBottom: "14px" }}>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {filters.map((item) => {
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
                      fontWeight: 900,
                      cursor: "pointer",
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
                  minHeight: "38px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--cream)",
                  padding: "0 10px",
                  fontSize: "13px",
                }}
              >
                {manualQaSections.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            )}
          </section>

          {summary.fail > 0 && (
            <div
              style={{
                border: "1px solid rgba(255,107,107,0.45)",
                borderRadius: "8px",
                background: "rgba(255,107,107,0.1)",
                color: "#FFB6B6",
                padding: "12px",
                display: "flex",
                gap: "8px",
                alignItems: "center",
                marginBottom: "14px",
                fontSize: "13px",
                fontWeight: 800,
              }}
            >
              <XCircle size={17} />
              Resolve failed P0/P1 checks before launch.
            </div>
          )}

          {summary.fail === 0 && summary.notTested === 0 && (
            <div
              style={{
                border: "1px solid rgba(68,214,121,0.4)",
                borderRadius: "8px",
                background: "rgba(68,214,121,0.1)",
                color: "var(--green)",
                padding: "12px",
                display: "flex",
                gap: "8px",
                alignItems: "center",
                marginBottom: "14px",
                fontSize: "13px",
                fontWeight: 800,
              }}
            >
              <CheckCircle2 size={17} />
              Manual QA checklist is complete.
            </div>
          )}

          <section style={{ display: "grid", gap: "10px" }}>
            {visibleTests.map((test) => {
              const result = getResult(results, test.id);
              return (
                <TestCard
                  key={test.id}
                  test={test}
                  result={result}
                  onStatus={(status) => updateResult(test.id, { status })}
                  onNotes={(notes) => updateResult(test.id, { notes })}
                />
              );
            })}
          </section>
        </>
      )}
    </main>
  );
}
