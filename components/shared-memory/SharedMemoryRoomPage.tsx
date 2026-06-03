"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ImagePlus,
  MapPin,
  MoreHorizontal,
  Paperclip,
  Plus,
  Send,
  Star,
  Utensils,
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

type Tab = "chat" | "dishes" | "photos";
type PublishVisibility = "public" | "circle" | "memory";

const members = [
  { name: "You", initials: "Y", color: "var(--orange)" },
  { name: "Rahul", initials: "R", color: "var(--green)" },
  { name: "Meera", initials: "M", color: "var(--gold)" },
  { name: "Sana", initials: "S", color: "#8B5CF6" },
  { name: "Arjun", initials: "A", color: "#38BDF8" },
];

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

const checklist = [
  { label: "Restaurant completed", done: true },
  { label: "Friends completed", done: true },
  { label: "Dishes completed", done: true },
  { label: "Group rating pending", done: false },
  { label: "Final verdict pending", done: false },
];

const dishes = [
  { name: "Peri Peri Fries", rating: "4.6", label: "Best starter", friendsRated: "4 friends rated" },
  { name: "Chicken Wings", rating: "3.8", label: "Mixed opinions", friendsRated: "3 friends rated" },
  { name: "Mocktails", rating: "4.4", label: "Everyone liked", friendsRated: "5 friends rated" },
];

const photos = [
  { addedBy: "Sana", src: "/categories/dishes/pizza.png" },
  { addedBy: "Rahul", src: "/categories/dishes/burger.png" },
  { addedBy: "Meera", src: "/categories/places/nightlife.png" },
  { addedBy: "You", src: "/categories/dishes/chicken.png" },
];

const messages = [
  { type: "system", text: "You created a room for Prost Brew Pub · Jubilee Hills", time: "7:38 PM" },
  { type: "text", user: "Rahul", text: "Add the fries bro, those disappeared in 2 minutes 😂", time: "7:44 PM" },
  { type: "mine", user: "You", text: "Done. I added Peri Peri Fries and Chicken Wings.", time: "7:46 PM" },
  { type: "dish", user: "Meera", text: "Mocktails were actually good. I'll rate 4.5.", time: "8:03 PM" },
  { type: "photo", user: "Sana", text: "added 3 photos to the memory.", time: "8:15 PM" },
  { type: "text", user: "Rahul", text: "Wings were okay only. Not worth the hype.", time: "8:24 PM" },
] as const;

function Avatar({ initials, color, size = 34 }: { initials: string; color: string; size?: number }) {
  return (
    <div
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "999px",
        border: "2px solid var(--bg)",
        background: color,
        color: color === "var(--green)" ? "var(--on-green)" : "white",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size > 30 ? "12px" : "10px",
        fontWeight: 950,
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}

function IconButton({ children, label, onClick }: { children: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        width: "38px",
        height: "38px",
        borderRadius: "999px",
        border: "1px solid var(--border)",
        background: "rgba(33,28,23,0.9)",
        color: "var(--cream)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

function ChecklistCard() {
  const completed = checklist.filter((item) => item.done).length;
  return (
    <div style={{ border: "1px solid var(--border)", background: "var(--card)", borderRadius: "16px", padding: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "10px" }}>
        <div>
          <p style={{ color: "var(--cream)", fontSize: "15px", fontWeight: 950 }}>Memory checklist</p>
          <p style={{ color: "var(--muted)", fontSize: "11px", fontWeight: 750, marginTop: "2px" }}>Publish when the table agrees.</p>
        </div>
        <span
          style={{
            borderRadius: "999px",
            background: "var(--orange-dim)",
            color: "var(--orange)",
            padding: "6px 9px",
            fontSize: "12px",
            fontWeight: 950,
          }}
        >
          {completed}/5
        </span>
      </div>
      <div style={{ display: "grid", gap: "8px" }}>
        {checklist.map((item) => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <CheckCircle2 size={15} strokeWidth={2.2} color={item.done ? "var(--green)" : "var(--muted)"} />
            <span style={{ color: item.done ? "var(--cream)" : "var(--muted)", fontSize: "12px", fontWeight: 780 }}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatMessage({ message }: { message: (typeof messages)[number] }) {
  if (message.type === "system") {
    return (
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div
          style={{
            borderRadius: "999px",
            background: "rgba(122,110,101,0.14)",
            color: "var(--muted)",
            padding: "7px 11px",
            fontSize: "11px",
            fontWeight: 780,
            textAlign: "center",
          }}
        >
          {message.text}
        </div>
      </div>
    );
  }

  const member = members.find((item) => item.name === message.user) ?? members[1];
  const mine = message.type === "mine";
  return (
    <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", gap: "9px" }}>
      {!mine && <Avatar initials={member.initials} color={member.color} size={30} />}
      <div style={{ maxWidth: message.type === "photo" || message.type === "dish" ? "82%" : "76%" }}>
        {!mine && (
          <p style={{ color: "var(--muted)", fontSize: "10px", fontWeight: 900, marginBottom: "4px" }}>{message.user}</p>
        )}
        <div
          style={{
            borderRadius: mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
            border: message.type === "dish" ? "1px solid rgba(61,214,140,0.28)" : message.type === "photo" ? "1px solid rgba(240,96,48,0.28)" : "1px solid var(--border)",
            background: mine ? "var(--orange)" : "var(--card)",
            color: mine ? "white" : "var(--cream)",
            padding: message.type === "dish" || message.type === "photo" ? "10px" : "10px 12px",
          }}
        >
          {message.type === "dish" && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "7px" }}>
              <div style={{ width: "30px", height: "30px", borderRadius: "999px", background: "rgba(61,214,140,0.13)", color: "var(--green)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Utensils size={15} strokeWidth={2.2} />
              </div>
              <div>
                <p style={{ color: "var(--cream)", fontSize: "13px", fontWeight: 950 }}>Mocktails</p>
                <p style={{ color: "var(--gold)", fontSize: "11px", fontWeight: 900 }}>4.5 rating added</p>
              </div>
            </div>
          )}
          {message.type === "photo" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px", marginBottom: "8px" }}>
              {photos.slice(0, 3).map((photo) => (
                <div
                  key={photo.src}
                  style={{
                    height: "62px",
                    borderRadius: "10px",
                    background: `url('${photo.src}') center/cover, var(--surface)`,
                    border: "1px solid var(--border)",
                  }}
                />
              ))}
            </div>
          )}
          <p style={{ fontSize: "13px", lineHeight: 1.45, fontWeight: 750 }}>{message.text}</p>
        </div>
        <p style={{ color: "var(--muted)", fontSize: "10px", fontWeight: 750, marginTop: "4px", textAlign: mine ? "right" : "left" }}>
          {message.time}
        </p>
      </div>
    </div>
  );
}

function DishesTab() {
  return (
    <div style={{ display: "grid", gap: "12px" }}>
      <div style={{ border: "1px solid var(--border)", background: "var(--card)", borderRadius: "16px", padding: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <div>
            <p style={{ color: "var(--cream)", fontSize: "15px", fontWeight: 950 }}>Table Ordered</p>
            <p style={{ color: "var(--muted)", fontSize: "12px", fontWeight: 760, marginTop: "3px" }}>Dishes discussed by the room</p>
          </div>
          <button
            type="button"
            style={{
              minHeight: "36px",
              borderRadius: "999px",
              border: "none",
              background: "var(--orange)",
              color: "white",
              padding: "0 12px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              fontWeight: 950,
              cursor: "pointer",
            }}
          >
            <Plus size={14} strokeWidth={2.4} />
            Add dish
          </button>
        </div>
      </div>

      {dishes.map((dish) => (
        <div key={dish.name} style={{ border: "1px solid var(--border)", background: "var(--card)", borderRadius: "16px", padding: "14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ color: "var(--cream)", fontSize: "15px", fontWeight: 950 }}>{dish.name}</p>
              <p style={{ color: "var(--muted)", fontSize: "12px", fontWeight: 760, marginTop: "3px" }}>
                {dish.label} · {dish.friendsRated}
              </p>
            </div>
            <div style={{ minWidth: "58px", height: "36px", borderRadius: "999px", background: "rgba(232,168,48,0.12)", color: "var(--gold)", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", fontSize: "12px", fontWeight: 950 }}>
              <Star size={13} strokeWidth={2.2} fill="var(--gold)" />
              {dish.rating}
            </div>
          </div>
          <button
            type="button"
            style={{
              width: "100%",
              minHeight: "38px",
              borderRadius: "12px",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--cream)",
              marginTop: "12px",
              fontSize: "12px",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Discuss this dish
          </button>
        </div>
      ))}
    </div>
  );
}

function PhotosTab() {
  return (
    <div style={{ display: "grid", gap: "12px" }}>
      <button
        type="button"
        style={{
          minHeight: "118px",
          borderRadius: "16px",
          border: "1px dashed rgba(240,96,48,0.56)",
          background: "var(--orange-dim)",
          color: "var(--orange)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          cursor: "pointer",
        }}
      >
        <ImagePlus size={24} strokeWidth={2} />
        <span style={{ fontSize: "13px", fontWeight: 950 }}>Upload/add photo</span>
      </button>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" }}>
        {photos.map((photo) => (
          <div
            key={`${photo.addedBy}-${photo.src}`}
            style={{
              minHeight: "176px",
              borderRadius: "16px",
              border: "1px solid var(--border)",
              background: `linear-gradient(to top, rgba(14,11,8,0.78), rgba(14,11,8,0.08)), url('${photo.src}') center/cover, var(--card)`,
              display: "flex",
              alignItems: "flex-end",
              padding: "10px",
            }}
          >
            <span style={{ color: "white", fontSize: "11px", fontWeight: 900 }}>Added by {photo.addedBy}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Composer() {
  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        zIndex: 12,
        borderTop: "1px solid var(--border)",
        background: "rgba(14,11,8,0.96)",
        padding: "10px 20px calc(12px + env(safe-area-inset-bottom, 0px))",
        backdropFilter: "blur(14px)",
      }}
    >
      <div className="hide-scrollbar" style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "9px" }}>
        {[
          { label: "Add dish", Icon: Utensils },
          { label: "Add photo", Icon: Camera },
          { label: "Rate", Icon: Star },
          { label: "Invite", Icon: Users },
        ].map(({ label, Icon }) => (
          <button
            key={label}
            type="button"
            style={{
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--cream)",
              borderRadius: "999px",
              padding: "8px 10px",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              whiteSpace: "nowrap",
              fontSize: "12px",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            <Icon size={13} strokeWidth={2.2} color="var(--orange)" />
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "9px" }}>
        <button
          type="button"
          aria-label="Attach"
          style={{
            width: "40px",
            height: "40px",
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
          <Paperclip size={18} strokeWidth={2.1} />
        </button>
        <textarea
          placeholder="Message this memory room..."
          rows={1}
          style={{
            minHeight: "40px",
            maxHeight: "96px",
            flex: 1,
            borderRadius: "18px",
            border: "1px solid var(--border)",
            background: "var(--card)",
            color: "var(--cream)",
            outline: "none",
            resize: "none",
            padding: "10px 12px",
            fontFamily: "'DM Sans', sans-serif",
            fontSize: "13px",
            lineHeight: 1.35,
          }}
        />
        <button
          type="button"
          aria-label="Send"
          style={{
            width: "40px",
            height: "40px",
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
          <Send size={17} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}

function PublishSheet({
  visibility,
  setVisibility,
  onClose,
}: {
  visibility: PublishVisibility;
  setVisibility: (visibility: PublishVisibility) => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(0,0,0,0.58)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        className="card-slide-up"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "512px",
          borderRadius: "22px 22px 0 0",
          border: "1px solid var(--border)",
          background: "var(--surface)",
          padding: "18px 20px calc(20px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
          <div>
            <h2 style={{ color: "var(--cream)", fontSize: "19px", fontWeight: 950 }}>Publish Shared Memory?</h2>
            <p style={{ color: "var(--muted)", fontSize: "13px", fontWeight: 730, lineHeight: 1.45, marginTop: "6px" }}>
              This will turn the room into a shared food memory post.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", padding: "3px" }}
          >
            <X size={20} strokeWidth={2.2} />
          </button>
        </div>

        <div style={{ display: "grid", gap: "8px", marginTop: "18px" }}>
          {([
            { value: "public", label: "Public", sub: "Everyone can see it" },
            { value: "circle", label: "Circle", sub: "Your trusted food circle" },
            { value: "memory", label: "Only people in memory", sub: "Private group memory" },
          ] as { value: PublishVisibility; label: string; sub: string }[]).map((option) => {
            const active = visibility === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setVisibility(option.value)}
                style={{
                  borderRadius: "14px",
                  border: `1px solid ${active ? "var(--orange)" : "var(--border)"}`,
                  background: active ? "var(--orange-dim)" : "var(--card)",
                  color: "var(--cream)",
                  padding: "13px",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <p style={{ color: active ? "var(--orange)" : "var(--cream)", fontSize: "14px", fontWeight: 950 }}>{option.label}</p>
                <p style={{ color: "var(--muted)", fontSize: "12px", fontWeight: 730, marginTop: "3px" }}>{option.sub}</p>
              </button>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "16px" }}>
          <button
            type="button"
            onClick={onClose}
            style={{ minHeight: "48px", borderRadius: "14px", border: "1px solid var(--border)", background: "var(--card)", color: "var(--cream)", fontSize: "14px", fontWeight: 950, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{ minHeight: "48px", borderRadius: "14px", border: "none", background: "var(--orange)", color: "white", fontSize: "14px", fontWeight: 950, cursor: "pointer" }}
          >
            Publish
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SharedMemoryRoomPage() {
  const [activeTab, setActiveTab] = useState<Tab>("chat");
  const [showPublishSheet, setShowPublishSheet] = useState(false);
  const [publishVisibility, setPublishVisibility] = useState<PublishVisibility>("circle");

  return (
    <div
      style={{
        ...sharedMemoryTheme,
        minHeight: "100vh",
        marginBottom: "calc(-5rem - env(safe-area-inset-bottom, 0px) - 0.5rem)",
        background: "var(--bg)",
        color: "var(--cream)",
      }}
    >
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "rgba(14,11,8,0.96)",
          borderBottom: "1px solid var(--border)",
          backdropFilter: "blur(14px)",
        }}
      >
        <div className="px-5 pt-4 pb-3">
          <div style={{ display: "flex", alignItems: "flex-start", gap: "11px" }}>
            <Link href="/share" aria-label="Back to create" style={{ textDecoration: "none" }}>
              <IconButton label="Back">
                <ArrowLeft size={18} strokeWidth={2.2} />
              </IconButton>
            </Link>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                <h1 style={{ color: "var(--cream)", fontSize: "18px", lineHeight: 1.15, fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Prost Brew Pub Room
                </h1>
                <span style={{ borderRadius: "999px", background: "rgba(61,214,140,0.14)", color: "var(--green)", padding: "4px 7px", fontSize: "10px", fontWeight: 950 }}>
                  Live
                </span>
              </div>
              <p style={{ color: "var(--muted)", fontSize: "11px", lineHeight: 1.35, fontWeight: 760, marginTop: "4px" }}>
                Jubilee Hills · 5 members · Meera typing...
              </p>
            </div>
            <IconButton label="More options">
              <MoreHorizontal size={19} strokeWidth={2.2} />
            </IconButton>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginTop: "14px" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {members.map((member, index) => (
                <div key={member.name} style={{ marginLeft: index === 0 ? 0 : "-9px" }}>
                  <Avatar initials={member.initials} color={member.color} />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowPublishSheet(true)}
              style={{
                minHeight: "38px",
                borderRadius: "999px",
                border: "none",
                background: "var(--orange)",
                color: "white",
                padding: "0 14px",
                display: "flex",
                alignItems: "center",
                gap: "7px",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: "12px",
                fontWeight: 950,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <CheckCircle2 size={15} strokeWidth={2.3} />
              Publish Memory
            </button>
          </div>
        </div>

        <div className="px-5 pb-3">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", borderRadius: "14px", background: "var(--surface)", padding: "4px" }}>
            {([
              { value: "chat", label: "Chat" },
              { value: "dishes", label: "Dishes" },
              { value: "photos", label: "Photos" },
            ] as { value: Tab; label: string }[]).map((tab) => {
              const active = activeTab === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setActiveTab(tab.value)}
                  style={{
                    minHeight: "34px",
                    borderRadius: "11px",
                    border: "none",
                    background: active ? "var(--orange)" : "transparent",
                    color: active ? "white" : "var(--muted)",
                    fontSize: "12px",
                    fontWeight: 950,
                    cursor: "pointer",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="px-5 py-4" style={{ display: "grid", gap: "14px", paddingBottom: "132px" }}>
        {activeTab === "chat" && (
          <>
            <ChecklistCard />
            <div style={{ display: "grid", gap: "14px" }}>
              {messages.map((message, index) => (
                <ChatMessage key={`${message.type}-${index}`} message={message} />
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--muted)", fontSize: "11px", fontWeight: 800, padding: "2px 3px" }}>
              <span style={{ width: "7px", height: "7px", borderRadius: "999px", background: "var(--green)" }} />
              Meera is typing...
            </div>
          </>
        )}

        {activeTab === "dishes" && <DishesTab />}

        {activeTab === "photos" && (
          <>
            <div style={{ border: "1px solid rgba(61,214,140,0.22)", background: "rgba(61,214,140,0.08)", borderRadius: "16px", padding: "13px", display: "flex", gap: "10px" }}>
              <MapPin size={17} strokeWidth={2} color="var(--green)" style={{ flexShrink: 0 }} />
              <p style={{ color: "var(--cream)", fontSize: "12px", lineHeight: 1.45, fontWeight: 780 }}>
                Room photos stay private until this memory is published.
              </p>
            </div>
            <PhotosTab />
          </>
        )}
      </main>

      <Composer />

      {showPublishSheet && (
        <PublishSheet
          visibility={publishVisibility}
          setVisibility={setPublishVisibility}
          onClose={() => setShowPublishSheet(false)}
        />
      )}
    </div>
  );
}
