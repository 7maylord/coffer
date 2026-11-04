"use client";
import { useEffect, useRef, useState } from "react";
import { Icon, Mark } from "./icon";

export function KineticVault({ compact = false }: { compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState("Treasury");
  const details: Record<string, string> = {
    Treasury: "Every resource. One clear picture.",
    People: "Make room for the people behind the work.",
    Agents: "Give autonomy a thoughtful boundary.",
    Invoices: "From good work to money received.",
  };
  return (
    <div
      ref={ref}
      className={`kinetic-vault ${compact ? "compact" : ""}`}
      onPointerMove={(event) => {
        if (
          event.pointerType !== "mouse" ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
          document.documentElement.dataset.motion === "reduced"
        )
          return;
        const box = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty(
          "--rx",
          `${((event.clientY - box.top) / box.height - 0.5) * -9}deg`,
        );
        event.currentTarget.style.setProperty(
          "--ry",
          `${((event.clientX - box.left) / box.width - 0.5) * 12}deg`,
        );
      }}
      onPointerLeave={() => {
        ref.current?.style.setProperty("--rx", "0deg");
        ref.current?.style.setProperty("--ry", "0deg");
      }}
    >
      <div className="vault-grid" />
      <div className="vault-orbit orbit-one" />
      <div className="vault-orbit orbit-two" />
      <div className="vault-orbit orbit-three" />
      <div className="vault-scene">
        <div className="vault-stack stack-back" />
        <div className="vault-stack stack-mid" />
        <div className="vault-core">
          <div className="vault-corner tl" />
          <div className="vault-corner tr" />
          <div className="vault-corner bl" />
          <div className="vault-corner br" />
          <Mark />
          <span>YOUR COFFER</span>
          <div className="vault-dot" />
        </div>
        {(["Treasury", "People", "Agents", "Invoices"] as const).map(
          (label, index) => (
            <button
              key={label}
              className={`orbit-node node-${index} ${selected === label ? "selected" : ""}`}
              onClick={() => setSelected(label)}
              aria-pressed={selected === label}
            >
              <Icon
                name={
                  (["treasury", "people", "agents", "invoice"] as const)[index]
                }
              />
              <span>{label}</span>
              <span className="node-indicator" />
            </button>
          ),
        )}
        <svg
          className="vault-connections"
          viewBox="0 0 600 600"
          aria-hidden="true"
        >
          <path d="M300 300 135 150M300 300 480 220M300 300 440 430M300 300 130 400" />
          <circle className="flow-dot" r="3">
            <animateMotion
              dur="4s"
              repeatCount="indefinite"
              path="M135 150 300 300"
            />
          </circle>
          <circle className="flow-dot" r="3">
            <animateMotion
              dur="5s"
              repeatCount="indefinite"
              path="M300 300 440 430"
            />
          </circle>
        </svg>
      </div>
      <p className="vault-caption" aria-live="polite">
        <span className="live-dot" />
        {details[selected]}
      </p>
      <span className="coordinate coord-top">SYSTEM / 001</span>
      <span className="coordinate coord-bottom">BUILT AROUND YOU ↗</span>
    </div>
  );
}
export function MotionObserver() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("revealed");
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.1 },
    );
    document
      .querySelectorAll("[data-reveal]")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  return null;
}
