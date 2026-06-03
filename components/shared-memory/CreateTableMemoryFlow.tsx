"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Clock,
  MapPin,
  PenLine,
  Plus,
  Sparkles,
  Store,
  UserPlus,
  Users,
  X,
} from "lucide-react";

/*
  Backend TODO:
  - create shared_memory_rooms table
  - create shared_memory_members table
  - create shared_memory_messages table
  - create shared_memory_dishes table
  - create shared_memory_photos table
  - create room invite notification
  - publish room into final shared memory post
  - privacy handling before and after publish
*/

const suggestedFriends = ["rahul", "meera", "sana", "arjun", "nisha"];

const sharedMemoryTheme = {
  "--bg": "#0E0B08",
  "--surface": "#1A1410",
  "--card": "#211C17",
  "--border": "#2E2720",
  "--orange": "#F06030",
  "--orange-dim": "rgba(240, 96, 48, 0.12)",
  "--gold": "#E8A830",
  "--cream": "#F5EDD8",
  "--muted": "#8E8278",
  "--green": "#3DD68C",
  "--on-green": "#0E0B08",
} as CSSProperties;

function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <label
      style={{
        display: "block",
        marginBottom: "8px",
        color: "var(--muted)",
        fontSize: "10px",
        fontWeight: 800,
        letterSpacing: "1px",
        textTransform: "uppercase",
      }}
    >
      {children}
      {optional && (
        <span style={{ marginLeft: "6px", fontSize: "10px", fontWeight: 600, letterSpacing: 0, textTransform: "none" }}>
          optional
        </span>
      )}
    </label>
  );
}

function SetupField({
  icon,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  icon: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        minHeight: "56px",
        borderRadius: "14px",
        border: "1px solid var(--border)",
        background: "var(--card)",
        padding: "0 14px",
      }}
    >
      {icon}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--cream)",
          fontFamily: "'DM Sans', sans-serif",
          fontSize: "14px",
          fontWeight: 800,
        }}
      />
    </div>
  );
}

export default function CreateTableMemoryFlow() {
  const router = useRouter();
  const [mode, setMode] = useState<"choice" | "table">("choice");
  const [restaurantName, setRestaurantName] = useState("Prost Brew Pub");
  const [location, setLocation] = useState("Jubilee Hills");
  const [visitDate, setVisitDate] = useState("");
  const [visitTime, setVisitTime] = useState("");
  const [friendInput, setFriendInput] = useState("");
  const [friends, setFriends] = useState(["rahul", "meera", "sana"]);

  function addFriend(raw: string) {
    const next = raw.trim().replace(/^@/, "").toLowerCase();
    if (!next || friends.includes(next)) return;
    setFriends((current) => [...current, next]);
    setFriendInput("");
  }

  return (
    <div
      style={{
        ...sharedMemoryTheme,
        minHeight: "100vh",
        marginBottom: "calc(-5rem - env(safe-area-inset-bottom, 0px) - 0.5rem)",
        background: "var(--bg)",
      }}
    >
      <div className="px-5 pt-6 pb-5">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {mode === "table" && (
            <button
              type="button"
              aria-label="Back"
              onClick={() => setMode("choice")}
              style={{
                width: "38px",
                height: "38px",
                borderRadius: "999px",
                border: "1px solid var(--border)",
                background: "var(--card)",
                color: "var(--cream)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <ArrowLeft size={18} strokeWidth={2.2} />
            </button>
          )}
          <div>
            <p style={{ color: "var(--orange)", fontSize: "11px", fontWeight: 900, letterSpacing: "1px", textTransform: "uppercase" }}>
              Create
            </p>
            <h1 style={{ color: "var(--cream)", fontSize: "24px", fontWeight: 950, lineHeight: 1.1, marginTop: "4px" }}>
              {mode === "choice" ? "What are you sharing?" : "Start a table room"}
            </h1>
          </div>
        </div>
      </div>

      {mode === "choice" ? (
        <div className="px-5 pb-6">
          <div style={{ display: "grid", gap: "12px" }}>
            <button
              type="button"
              onClick={() => router.push("/reviews/new")}
              style={{
                minHeight: "132px",
                borderRadius: "16px",
                border: "1px solid var(--border)",
                background: "var(--card)",
                color: "var(--cream)",
                padding: "18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "16px",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div>
                <div
                  style={{
                    width: "42px",
                    height: "42px",
                    borderRadius: "999px",
                    background: "var(--orange-dim)",
                    color: "var(--orange)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "14px",
                  }}
                >
                  <PenLine size={20} strokeWidth={2.2} />
                </div>
                <h2 style={{ fontSize: "18px", fontWeight: 950, color: "var(--cream)" }}>Solo Bite</h2>
                <p style={{ marginTop: "4px", fontSize: "13px", fontWeight: 700, color: "var(--muted)", lineHeight: 1.4 }}>
                  Post your own food review.
                </p>
              </div>
              <ChevronRight size={21} strokeWidth={2.3} color="var(--muted)" />
            </button>

            <button
              type="button"
              onClick={() => setMode("table")}
              style={{
                minHeight: "150px",
                borderRadius: "16px",
                border: "1px solid rgba(61,214,140,0.28)",
                background: "linear-gradient(135deg, rgba(61,214,140,0.13), rgba(240,96,48,0.10)), var(--card)",
                color: "var(--cream)",
                padding: "18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "16px",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div>
                <div
                  style={{
                    width: "42px",
                    height: "42px",
                    borderRadius: "999px",
                    background: "rgba(61,214,140,0.14)",
                    color: "var(--green)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "14px",
                  }}
                >
                  <Users size={21} strokeWidth={2.2} />
                </div>
                <h2 style={{ fontSize: "18px", fontWeight: 950, color: "var(--cream)" }}>Table Memory</h2>
                <p style={{ marginTop: "4px", fontSize: "13px", fontWeight: 700, color: "var(--muted)", lineHeight: 1.4 }}>
                  Create a private food room with friends before publishing.
                </p>
              </div>
              <ChevronRight size={21} strokeWidth={2.3} color="var(--green)" />
            </button>
          </div>
        </div>
      ) : (
        <form
          className="px-5 pb-7"
          onSubmit={(event) => {
            event.preventDefault();
            router.push("/memory-room/prost-brew-pub");
          }}
          style={{ display: "flex", flexDirection: "column", gap: "18px" }}
        >
          <section>
            <FieldLabel>Restaurant</FieldLabel>
            <SetupField
              icon={<Store size={17} strokeWidth={2} color="var(--orange)" style={{ flexShrink: 0 }} />}
              value={restaurantName}
              onChange={setRestaurantName}
              placeholder="Restaurant or pub name"
            />
          </section>

          <section>
            <FieldLabel>Location</FieldLabel>
            <SetupField
              icon={<MapPin size={17} strokeWidth={2} color="var(--green)" style={{ flexShrink: 0 }} />}
              value={location}
              onChange={setLocation}
              placeholder="Area or city"
            />
          </section>

          <section>
            <FieldLabel>Friends to invite</FieldLabel>
            <div
              style={{
                borderRadius: "14px",
                border: "1px solid var(--border)",
                background: "var(--card)",
                padding: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <UserPlus size={17} strokeWidth={2} color="var(--orange)" style={{ flexShrink: 0 }} />
                <input
                  value={friendInput}
                  onChange={(event) => setFriendInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      addFriend(friendInput);
                    }
                  }}
                  placeholder="Type username and press Enter"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: "var(--cream)",
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: "14px",
                  }}
                />
                <button
                  type="button"
                  aria-label="Add friend"
                  onClick={() => addFriend(friendInput)}
                  style={{
                    width: "31px",
                    height: "31px",
                    borderRadius: "999px",
                    border: "none",
                    background: "var(--orange)",
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <Plus size={17} strokeWidth={2.4} />
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
                {friends.map((friend) => (
                  <span
                    key={friend}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      borderRadius: "999px",
                      border: "1px solid var(--border)",
                      background: "var(--surface)",
                      color: "var(--cream)",
                      padding: "8px 10px",
                      fontSize: "12px",
                      fontWeight: 900,
                    }}
                  >
                    @{friend}
                    <button
                      type="button"
                      aria-label={`Remove ${friend}`}
                      onClick={() => setFriends((current) => current.filter((item) => item !== friend))}
                      style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", padding: 0, display: "flex" }}
                    >
                      <X size={13} strokeWidth={2.5} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingTop: "10px" }} className="hide-scrollbar">
              {suggestedFriends
                .filter((friend) => !friends.includes(friend))
                .map((friend) => (
                  <button
                    key={friend}
                    type="button"
                    onClick={() => addFriend(friend)}
                    style={{
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--muted)",
                      borderRadius: "999px",
                      padding: "7px 10px",
                      fontSize: "12px",
                      fontWeight: 850,
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                    }}
                  >
                    @{friend}
                  </button>
                ))}
            </div>
          </section>

          <section>
            <FieldLabel optional>Date and time</FieldLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <SetupField
                icon={<CalendarDays size={16} strokeWidth={2} color="var(--muted)" style={{ flexShrink: 0 }} />}
                value={visitDate}
                onChange={setVisitDate}
                placeholder="Date"
                type="date"
              />
              <SetupField
                icon={<Clock size={16} strokeWidth={2} color="var(--muted)" style={{ flexShrink: 0 }} />}
                value={visitTime}
                onChange={setVisitTime}
                placeholder="Time"
                type="time"
              />
            </div>
          </section>

          <div
            style={{
              borderRadius: "14px",
              border: "1px solid rgba(61,214,140,0.22)",
              background: "rgba(61,214,140,0.08)",
              padding: "13px",
              display: "flex",
              gap: "10px",
            }}
          >
            <Sparkles size={17} strokeWidth={2} color="var(--green)" style={{ flexShrink: 0, marginTop: "1px" }} />
            <p style={{ color: "var(--cream)", fontSize: "12px", lineHeight: 1.45, fontWeight: 750 }}>
              The room stays private to invited friends until the creator publishes the final memory.
            </p>
          </div>

          <button
            type="submit"
            style={{
              width: "100%",
              minHeight: "54px",
              borderRadius: "16px",
              border: "none",
              background: "var(--orange)",
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "15px",
              fontWeight: 950,
              cursor: "pointer",
            }}
          >
            Create Memory Room
            <ChevronRight size={18} strokeWidth={2.5} />
          </button>
        </form>
      )}
    </div>
  );
}
