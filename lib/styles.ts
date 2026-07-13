export const btnStyle: React.CSSProperties = {
  background: "var(--bg-hover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "5px 12px",
  fontSize: 11,
  color: "var(--text)",
  cursor: "pointer",
};

export const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 8px",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 5,
  color: "var(--text)",
  boxSizing: "border-box",
};

export const selectStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: "inherit",
};

export const cardStyle: React.CSSProperties = {
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 10,
};

export const statusBannerStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 10,
  marginBottom: 12,
  fontSize: 12,
};

export const btnStyleMuted: React.CSSProperties = {
  fontSize: 11,
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
};

export const errorTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#f87171",
};

export const errorBoxStyle: React.CSSProperties = {
  padding: 16,
  fontSize: 12,
  color: "#f87171",
};

export const errorBoxStylePre: React.CSSProperties = {
  fontSize: 13,
  color: "#ef4444",
  whiteSpace: "pre-wrap",
};

export const errorBoxStylePre12: React.CSSProperties = {
  fontSize: 12,
  color: "#ef4444",
  whiteSpace: "pre-wrap",
};

export const loadingBoxStyle: React.CSSProperties = {
  padding: 16,
  fontSize: 12,
  color: "var(--text-muted)",
};

export const iconButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  padding: 0,
  background: "var(--bg-hover)",
  border: "1px solid var(--border)",
  borderRadius: 7,
  color: "var(--text-muted)",
  cursor: "pointer",
  flexShrink: 0,
  transition: "background 0.12s, color 0.12s, border-color 0.12s",
};

export const iconButtonStyleHover: React.CSSProperties = {
  background: "var(--bg-selected)",
  color: "var(--accent)",
  borderColor: "var(--accent-soft)",
};

export const iconButtonStyleHoverError: React.CSSProperties = {
  background: "var(--error-bg)",
  color: "var(--color-error-border)",
  borderColor: "var(--error-soft)",
};

export const iconButtonStyleDefault: React.CSSProperties = {
  background: "var(--bg-hover)",
  color: "var(--text-muted)",
  borderColor: "var(--border)",
};

export const collapseButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 20,
  height: 20,
  padding: 0,
  flexShrink: 0,
  background: "none",
  border: "none",
  color: "var(--text-dim)",
  cursor: "pointer",
  transition: "transform 0.15s",
};

export const smallInputStyle: React.CSSProperties = {
  flex: 1,
  fontSize: 12,
  padding: "5px 8px",
  border: "1px solid var(--accent)",
  borderRadius: 5,
  outline: "none",
  background: "var(--bg)",
  color: "var(--text)",
  height: 30,
};
