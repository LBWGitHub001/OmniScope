"""Serial Assistant feature — standalone UART debugger for robots and embedded MCUs."""

from __future__ import annotations

import json
from typing import List

from ..http.sse import SSEQueue, write_sse
from ..swd.serial_link import SerialLink, parse_hex_payload
from .base import Feature, json_body, send_json


class SerialFeature(Feature):
    id = "serial"
    title = "Serial Assistant"
    description = "独立串口调试助手：端口侦测、波特率切换、文本/HEX 双向高速收发"

    def __init__(self):
        super().__init__()
        self.sse = SSEQueue()
        self._clients: List[SSEQueue] = []
        self.serial = SerialLink(self.publish)

    def attach(self, shell):
        p = getattr(self, "api_prefix", f"/api/{self.id}")
        shell.route(p + "/ports", self._handle_ports)
        shell.route(p + "/open", self._handle_open, methods=("POST",))
        shell.route(p + "/close", self._handle_close, methods=("POST",))
        shell.route(p + "/send", self._handle_send, methods=("POST",))
        shell.route(p + "/status", self._handle_status)
        shell.route(p + "/events", self._handle_events)

    def on_stop(self):
        self.serial.close()

    def run(self, stop_event):
        stop_event.wait()

    def publish(self, event: dict) -> None:
        line = json.dumps(event, ensure_ascii=False)
        self.sse.put(line)
        with self._lock:
            clients = list(self._clients)
        for q in clients:
            try:
                q.put(line)
            except Exception:
                pass

    def _handle_ports(self, handler):
        ports = self.serial.list_ports()
        st = self.serial.status()
        send_json(handler, {"ports": ports, **st})

    def _handle_status(self, handler):
        send_json(handler, self.serial.status())

    def _handle_open(self, handler):
        body = json_body(handler)
        port = str(body.get("port", "")).strip()
        baud = int(body.get("baud", 115200))
        if not port:
            send_json(handler, {"error": "未选择串口设备"}, code=400)
            return
        try:
            st = self.serial.open(port, baud)
            send_json(handler, {"ok": True, **st})
        except Exception as exc:
            send_json(handler, {"ok": False, "error": str(exc)}, code=400)

    def _handle_close(self, handler):
        st = self.serial.close()
        send_json(handler, {"ok": True, **st})

    def _handle_send(self, handler):
        body = json_body(handler)
        mode = str(body.get("mode", "text"))
        payload = str(body.get("data", ""))
        try:
            if mode == "hex":
                data = parse_hex_payload(payload)
            else:
                if body.get("newline"):
                    payload += "\r\n"
                data = payload.encode("utf-8")
            st = self.serial.send(data)
            send_json(handler, {"ok": True, **st})
        except Exception as exc:
            send_json(handler, {"ok": False, "error": str(exc)}, code=400)

    def _handle_events(self, handler):
        q = SSEQueue()
        with self._lock:
            self._clients.append(q)

        try:
            st = self.serial.status()
            q.put(json.dumps({"type": "serial", "dir": "status", **st}, ensure_ascii=False))
            write_sse(handler, q)
        finally:
            with self._lock:
                if q in self._clients:
                    self._clients.remove(q)
