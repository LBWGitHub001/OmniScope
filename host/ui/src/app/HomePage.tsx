import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { FEATURE_MODULES } from "../features/registry";
import { featureStatus, getJson, listInstances, openFeature } from "../shared/api";
import { InstanceProvider } from "../shared/instance";
import { featureFromApp } from "../shared/robotFeature";

type Row = {
  instance: string;
  feature: string;
  title: string;
  state: string;
  sender?: string;
  data_port?: number;
  path?: string;
};

type Robot = {
  name: string;
  ip: string;
  data_port: number;
  watches: number;
  app?: string;
  feature?: string;
};

const HOME_TOOLS = FEATURE_MODULES.filter((m) => m.id !== "watch" && m.id !== "calibrate");

function LogoIcon() {
  return (
    <svg className="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
      <line x1="12" y1="22" x2="12" y2="15.5" />
      <polyline points="22 8.5 12 15.5 2 8.5" />
      <polyline points="2 15.5 12 8.5 22 15.5" />
      <line x1="12" y1="2" x2="12" y2="8.5" />
    </svg>
  );
}

export function HomePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [robots, setRobots] = useState<Robot[]>([]);
  const [err, setErr] = useState("");
  const [manual, setManual] = useState("");

  useEffect(() => {
    let dead = false;
    const tick = async () => {
      try {
        const r = await listInstances();
        if (!dead) setRows(r.instances || []);
        const bots = await getJson<{ robots: Robot[] }>("/api/robots");
        if (!dead) setRobots(bots.robots || []);
      } catch {
        /* hub down */
      }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, []);

  const open = async (feature: string, config: Record<string, unknown> = {}) => {
    setErr("");
    try {
      const r = await openFeature(feature, config);
      const w = window.open(r.path, "_blank");
      if (!w) setErr("浏览器拦截了新窗口，请允许弹窗后重试");
    } catch (e) {
      setErr(String(e));
    }
  };

  const openRobot = (r: Robot) => {
    const feat =
      r.feature === "calibrate" || r.feature === "watch"
        ? r.feature
        : featureFromApp(r.app);
    open(feat, { sender: r.name });
  };

  const openManual = () => {
    const name = manual.trim();
    if (!name) return;
    const known = robots.find((r) => r.name === name);
    if (known) openRobot(known);
    else open("watch", { sender: name });
  };

  return (
    <div className="app-shell">
      {/* Topbar */}
      <header className="topbar">
        <div className="brand-group">
          <LogoIcon />
          <span className="brand">OmniScope</span>
        </div>
        <span className="topbar-sep" />
        <span className="topbar-title" style={{ fontSize: "12px", color: "var(--muted)" }}>
          Robotics & Embedded Debug Studio
        </span>
        <div className="spacer" />
        <div className="status-pill">
          <span className="pulse-dot"></span>
          <span>Hub 在线 · {rows.length ? `${rows.length} 活跃线程` : "就绪"}</span>
        </div>
      </header>

      {/* Main Container */}
      <div className="main">
        <div className="home">
          <header className="page-head">
            <h1>集成调试控制台</h1>
            <p className="sub">
              面向机器人与嵌入式系统的全景观测视窗。每个功能均在独立线程与独立页面中运行，互不干扰。
            </p>
          </header>

          {err && <p className="err-text">{err}</p>}

          {/* Feature Grid */}
          <section className="block">
            <div className="sec-label">调试工具矩阵 (Debugging Modules)</div>
            <div className="tool-grid">
              {HOME_TOOLS.map((m) => (
                <div key={m.id} className="tool-card" onClick={() => open(m.id)}>
                  <div className="tool-card-head">
                    <span className="tool-card-id">{m.id.toUpperCase()}</span>
                    <span style={{ fontSize: "11px", color: "var(--muted)" }}>新窗口 ↗</span>
                  </div>
                  <div className="tool-card-title">{m.title}</div>
                  <div className="tool-card-desc">{m.description}</div>
                  <div className="tool-card-action">
                    <span>启动模块</span>
                    <span style={{ fontSize: "13px" }}>→</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Connected Robots Section */}
          <section className="block">
            <div className="sec-label">在线车辆 / 边缘设备 (Discovered Targets)</div>
            {robots.length > 0 ? (
              <div className="robot-grid">
                {robots.map((r) => {
                  const feat =
                    r.feature === "calibrate" || r.feature === "watch"
                      ? r.feature
                      : featureFromApp(r.app);
                  return (
                    <div key={r.name} className="robot-card" onClick={() => openRobot(r)}>
                      <div className="robot-info">
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span className="pulse-dot"></span>
                          <span className="robot-name">{r.name}</span>
                          {r.app && r.app !== "normal" && (
                            <span
                              style={{
                                fontSize: "10px",
                                background: "var(--amber-dim)",
                                color: "var(--amber)",
                                padding: "1px 4px",
                                borderRadius: "3px",
                              }}
                            >
                              {r.app}
                            </span>
                          )}
                        </div>
                        <span className="robot-meta">
                          {r.ip} · UDP {r.data_port || 15001}
                        </span>
                      </div>
                      <button type="button" className="ghost" style={{ fontSize: "12px", color: "var(--cyan)" }}>
                        打开 {feat} ↗
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="empty">
                局域网内暂未发现广播车辆（Beacon :15999）。您可以直接输入车名手动发起连接。
              </p>
            )}

            <form
              className="launcher-manual"
              onSubmit={(e) => {
                e.preventDefault();
                openManual();
              }}
            >
              <input
                value={manual}
                placeholder="手动指定车名 (sender_name)..."
                onChange={(e) => setManual(e.target.value)}
              />
              <button type="submit" disabled={!manual.trim()}>
                打开 Watch
              </button>
            </form>
          </section>

          {/* Running Instances List */}
          {rows.length > 0 && (
            <section className="block">
              <div className="sec-label">已挂载活动实例 (Active Instances)</div>
              <ul className="inst-list">
                {rows.map((r) => (
                  <li key={r.instance}>
                    <a href={r.path || `/i/${r.instance}`} target="_blank" rel="noreferrer">
                      <div>
                        <span className="inst-title">{r.title}</span>
                        {r.sender && (
                          <span style={{ color: "var(--cyan)", marginLeft: "8px", fontSize: "12px" }}>
                            @{r.sender}
                          </span>
                        )}
                      </div>
                      <span className="inst-meta mono">
                        {r.data_port ? `UDP :${r.data_port}` : r.instance}
                      </span>
                      <span className={`state-tag s-${r.state}`}>{r.state}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export function InstancePage() {
  const { iid } = useParams();
  const [feature, setFeature] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!iid) return;
    featureStatus(iid)
      .then((st) => setFeature(st.feature || ""))
      .catch(() => setErr("这个页面对应的线程已经关闭"));
  }, [iid]);

  const mod = FEATURE_MODULES.find((m) => m.id === feature);
  const close = () => {
    if (!iid) return;
    const url = `/api/instances/${iid}/stop?forget=1`;
    if (navigator.sendBeacon) navigator.sendBeacon(url, "");
    window.close();
    window.location.href = "/";
  };

  useEffect(() => {
    if (feature === "calibrate" && iid) {
      window.location.replace(`/calibrate.html?i=${iid}`);
    }
  }, [feature, iid]);

  if (feature === "calibrate") {
    return <p className="page-pad muted">正在打开标定页…</p>;
  }

  return (
    <div className="app-shell">
      {/* Topbar with Breadcrumbs */}
      <header className="topbar">
        <a href="/" className="brand-group" target="_blank" rel="noreferrer">
          <LogoIcon />
          <span className="brand">OmniScope</span>
        </a>
        <span className="topbar-sep" />
        <div className="topbar-breadcrumbs">
          <span>Studio</span>
          <span>/</span>
          {mod && <span className="active">{mod.title}</span>}
          <span>/</span>
          <span className="mono" style={{ color: "var(--faint)", fontSize: "11px" }}>
            {iid}
          </span>
        </div>
        <div className="spacer" />
        <div className="status-pill">
          <span className="pulse-dot"></span>
          <span>线程运行中</span>
        </div>
        <button type="button" className="ghost" style={{ fontSize: "12px", color: "var(--err)" }} onClick={close}>
          关闭实例 ✕
        </button>
      </header>

      {/* Feature Main Content */}
      <div className="main">
        {err && <p className="err-text page-pad">{err}</p>}
        {mod && iid && mod.Component && (
          <InstanceProvider value={{ id: iid, feature: mod.id, base: `/api/i/${iid}` }}>
            <mod.Component />
          </InstanceProvider>
        )}
      </div>
    </div>
  );
}
