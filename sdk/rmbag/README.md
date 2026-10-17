# RMB1 / `.rmbag`

算法用满帧率、无压缩录放格式。与 RemoteLogger 的 `.rlog`（RLG2、JPEG、约 30fps）**完全独立**。

没有 pty/socat 虚拟串口假源。`configs/sentry.yaml` 里的 `virtual_serial` 原先未接线；现已由 `gimbal_source: virtual`（或 `virtual_serial: true`）提供**固定姿态**，不是 bag 回放。

## 文件布局

```
magic "RMB1" (4B LE 0x31424D52)
header_len (4B LE)
header JSON (header_len)
重复:
  type 0x01 FRAME
    ts_ns u64
    q_w q_x q_y q_z  f64
    yaw_deg pitch_deg roll_deg  f32
    mode u8
    pad 3B
    width height step data_len  u32
    pixels BGR8[data_len]      data_len == step * height
type 0x03 FOOTER
  json_len u32
  footer JSON
```

同一条 `FRAME` 对齐图像时间戳与云台 `q` / 欧拉角 / 模式。

## Header JSON（开录写一次）

含 `config.text`（yaml 全文）、`timing.start_wall_ns`、`host`（hostname/os/cwd）、`git`、`camera`、`gimbal`、`device.name`、`recorder.argv`。

## Footer JSON（停录追加）

`duration_s`、`frame_count`、`dropped_frames`、`bytes_written`、`avg_fps`、`last_ts_ns`。截断文件无 Footer 仍可按帧回放。

## 录制

真机相机 + 真串口云台：

```bash
./rmbag_record configs/standard3.yaml -o records/run --device-name standard3
# → records/run_<ts>.rmbag
```

异步有界队列（32 帧）；磁盘跟不上会丢最旧并在结束时打印 `dropped_frames`。全分辨率 BGR 带宽很高，建议 NVMe。

## 回放（进程内假数据源）

```yaml
camera_name: "bag"
gimbal_source: "bag"
bag_path: "records/run.rmbag"
bag_loop: true
bag_realtime: true
```

`BagCamera::read` 推进帧；`Gimbal::q/mode/state` 读当前帧；`send` 丢弃。

桌面无下位机可用 `gimbal_source: virtual`（固定 yaw/pitch）。`configs/sentry.yaml` 的 `virtual_serial` **仍未作为开关**（避免该文件里 `true` 误关掉真串口）；请显式写 `gimbal_source`。

```bash
./rmbag_replay configs/rmbag_replay.yaml
```

改 yaml 里的 `bag_path` 指向实际文件。算法仍用该 yaml 的标定/YOLO 参数；若与 bag 内嵌 `config.path` 不一致会 WARN。

`gimbal_source` 缺省为真串口；`virtual` 为固定 yaw/pitch（桌面无下位机）。
