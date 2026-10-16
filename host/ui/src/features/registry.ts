import type { FeatureModule } from "./types";
import { WatchPage } from "./watch/WatchPage";
import { ReplayPage } from "./replay/ReplayPage";
import { DumpPage } from "./dump/DumpPage";
import { NetcheckPage } from "./netcheck/NetcheckPage";
import { SwdPage } from "./swd/SwdPage";

/** Frontend feature registry — add a module here to show on the home page. */
export const FEATURE_MODULES: FeatureModule[] = [
  {
    id: "watch",
    title: "Watch",
    description: "实时接收车上 RemoteLogger：曲线、日志、图像",
    route: "/watch",
    Component: WatchPage,
  },
  {
    id: "calibrate",
    title: "Calibrate",
    description: "棋盘格相机内参标定：覆盖度、采样、一键标定",
    route: "/calibrate",
  },
  {
    id: "replay",
    title: "Replay",
    description: "本地回放 .rlog：时间轴、曲线、图像、日志",
    route: "/replay",
    Component: ReplayPage,
  },
  {
    id: "dump",
    title: "Dump",
    description: "导出 log.txt / plot.txt / images.mp4",
    route: "/dump",
    Component: DumpPage,
  },
  {
    id: "netcheck",
    title: "Netcheck",
    description: "UDP discover / echo / ping",
    route: "/netcheck",
    Component: NetcheckPage,
  },
  {
    id: "swd",
    title: "SWD",
    description: "OpenOCD SWD 内存符号非侵入式实时监视与波形",
    route: "/swd",
    Component: SwdPage,
  },
];
