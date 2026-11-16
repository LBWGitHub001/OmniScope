import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { FEATURE_MODULES } from "../features/registry";
import { featureStatus, getJson, listInstances, openFeature } from "../shared/api";
import { InstanceProvider } from "../shared/instance";
import { featureFromApp } from "../shared/robotFeature";
import { AppShell } from "./AppShell";

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

const HOME_TOOLS = FEATURE_MODULES.filter((m) => m.id !== "watch");

export function HomePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [robots, setRobots] = useState<Robot[]>([]);
  const [err, setErr] = useState("");
  const [manual, setManual] = useState("");
  const [hubOnline, setHubOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let dead = false;
    const tick = async () => {
      try {
        const [instances, discovered] = await Promise.all([
          listInstances(),
          getJson<{ robots: Robot[] }>("/api/robots"),
        ]);
        if (dead) return;
        setRows(instances.instances || []);
        setRobots(discovered.robots || []);
        setHubOnline(true);
      } catch {
        if (!dead) setHubOnline(false);
      }
    };
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, []);

  const open = async (feature: string, config: Record<string, unknown> = {}) => {
    setErr("");
    try {
      const result = await openFeature(feature, config);
      const senderParam = config.sender ? `&sender=${encodeURIComponent(String(config.sender))}` : "";
      const url = result.path ? `${result.path}?feature=${feature}${senderParam}` : result.path;
      const popup = window.open(url, "_blank");
      if (!popup) setErr("浏览器拦截了新窗口，请允许弹窗后重试");
    } catch (error) {
      setErr(String(error));
    }
  };

  const openRobot = (robot: Robot) => {
    const feature =
      robot.feature === "calibrate" || robot.feature === "watch"
        ? robot.feature
        : featureFromApp(robot.app);
    open(feature, { sender: robot.name });
  };

  const openManual = () => {
    const name = manual.trim();
    if (!name) return;
    const known = robots.find((robot) => robot.name === name);
    if (known) openRobot(known);
    else open("watch", { sender: name });
  };

  const status = hubOnline === false ? "Hub 离线" : rows.length ? `${rows.length} 个页面` : "无打开页面";

  return (
    <AppShell title="Host" status={status} statusTone={hubOnline === false ? "error" : "neutral"}>
      <div className="home">
        <header className="page-head">
          <h1>调试入口</h1>
          <p className="sub">每个功能在独立页面和线程中运行，可以同时打开多个实例。</p>
        </header>
        {err && <p className="err-text">{err}</p>}

        <section className="block">
          <div className="sec-label">功能</div>
          <div className="launcher">
            {HOME_TOOLS.map((module) => (
              <button key={module.id} type="button" className="tool" onClick={() => open(module.id)}>
                <span className="tool-id">{module.id}</span>
                <span className="tool-body">
                  <span className="tool-title">{module.title}</span>
                  <span className="tool-desc">{module.description}</span>
                </span>
                <span className="tool-go">新窗口</span>
              </button>
            ))}
          </div>
        </section>

        <section className="block">
          <div className="sec-label">车辆</div>
          <div className="launcher">
            {robots.map((robot) => {
              const feature =
                robot.feature === "calibrate" || robot.feature === "watch"
                  ? robot.feature
                  : featureFromApp(robot.app);
              const meta = [
                robot.app && robot.app !== "normal" ? `app=${robot.app}` : "",
                robot.ip,
                robot.data_port ? `UDP ${robot.data_port}` : "",
              ].filter(Boolean).join(" · ");
              return (
                <button key={robot.name} type="button" className="tool" onClick={() => openRobot(robot)}>
                  <span className="tool-id">{feature}</span>
                  <span className="tool-body">
                    <span className="tool-title">{robot.name}</span>
                    {meta && <span className="tool-desc mono">{meta}</span>}
                  </span>
                  <span className="tool-go">新窗口</span>
                </button>
              );
            })}
            {robots.length === 0 && (
              <p className="empty launcher-empty">
                {hubOnline === false ? "无法连接 Hub，请检查 Host 是否运行。" : "暂未发现车辆，可以直接输入车名。"}
              </p>
            )}
            <form
              className="launcher-manual"
              onSubmit={(event) => {
                event.preventDefault();
                openManual();
              }}
            >
              <input
                value={manual}
                placeholder="车名 sender_name"
                onChange={(event) => setManual(event.target.value)}
              />
              <button type="submit" disabled={!manual.trim()}>
                打开 Watch
              </button>
            </form>
          </div>
        </section>

        {rows.length > 0 && (
          <section className="block">
            <div className="sec-label">已打开</div>
            <ul className="inst-list">
              {rows.map((row) => (
                <li key={row.instance}>
                  <a href={row.path || `/i/${row.instance}`} target="_blank" rel="noreferrer">
                    <span className="inst-title">
                      {row.title}
                      {row.sender ? ` · ${row.sender}` : ""}
                    </span>
                    <span className="inst-meta mono">{row.data_port ? `UDP ${row.data_port}` : row.instance}</span>
                    <span className={`state-tag s-${row.state}`}>{row.state}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AppShell>
  );
}

export function InstancePage() {
  const { iid } = useParams();
  const [searchParams] = useSearchParams();
  const [feature, setFeature] = useState(searchParams.get("feature") || "");
  const [state, setState] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!iid) return;
    featureStatus(iid)
      .then((status) => {
        setFeature(status.feature || "");
        setState(status.state || "");
      })
      .catch(() => setErr("这个页面对应的线程已经关闭"));
  }, [iid]);

  const module = FEATURE_MODULES.find((item) => item.id === feature);
  const close = () => {
    if (!iid) return;
    const url = `/api/instances/${iid}/stop?forget=1`;
    if (navigator.sendBeacon) navigator.sendBeacon(url, "");
    window.close();
    window.location.href = "/";
  };

  return (
    <AppShell
      title={module?.title || "实例"}
      status={err ? "已关闭" : state || "加载中"}
      statusTone={err ? "error" : state === "running" ? "ok" : "neutral"}
      onClose={close}
    >
      {err && <p className="err-text page-pad">{err}</p>}
      {module && iid && module.Component && (
        <InstanceProvider value={{ id: iid, feature: module.id, base: `/api/i/${iid}` }}>
          <module.Component />
        </InstanceProvider>
      )}
    </AppShell>
  );
}
