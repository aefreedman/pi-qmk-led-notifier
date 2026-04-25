#!/usr/bin/env python3

import argparse
import json
import sys
import time
from dataclasses import dataclass
from typing import Any, Iterable, List, Optional

RAW_EPSIZE = 32
CMD_PING = 0x01
CMD_FLASH = 0x02
CMD_RGB = 0x03
CMD_RGB_AT = 0x04
STATUS_OK = 0x00


def parse_int_auto(value: str) -> int:
    token = str(value).strip().lower()
    base = 16 if token.startswith("0x") else 10
    return int(token, base)


def clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))


def load_hid_module():
    try:
        import hid  # type: ignore

        return hid
    except Exception as exc:  # pragma: no cover - runtime environment specific
        print(
            "ERROR: Python module 'hid' is unavailable. Install with: py -3 -m pip install --user hidapi",
            file=sys.stderr,
        )
        print(f"DETAIL: {exc}", file=sys.stderr)
        sys.exit(2)


@dataclass
class HidDeviceInfo:
    index: int
    path: str
    raw_path: Any
    vendor_id: int
    product_id: int
    usage_page: Optional[int]
    usage: Optional[int]
    interface_number: Optional[int]
    manufacturer_string: str
    product_string: str
    serial_number: str


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def normalize_path_for_open(value: Any) -> bytes:
    if isinstance(value, bytes):
        return value
    return str(value).encode("utf-8", errors="replace")


def enumerate_candidates(
    hid: Any,
    vid: int,
    pid: int,
    usage_page: int,
    usage: int,
) -> List[HidDeviceInfo]:
    rows: Iterable[dict] = hid.enumerate(vid, pid)
    devices: List[HidDeviceInfo] = []

    for row in rows:
        row_usage_page = row.get("usage_page")
        row_usage = row.get("usage")
        if row_usage_page != usage_page or row_usage != usage:
            continue

        devices.append(
            HidDeviceInfo(
                index=len(devices),
                path=normalize_text(row.get("path")),
                raw_path=row.get("path"),
                vendor_id=int(row.get("vendor_id", 0)),
                product_id=int(row.get("product_id", 0)),
                usage_page=row_usage_page,
                usage=row_usage,
                interface_number=row.get("interface_number"),
                manufacturer_string=normalize_text(row.get("manufacturer_string")),
                product_string=normalize_text(row.get("product_string")),
                serial_number=normalize_text(row.get("serial_number")),
            )
        )

    devices.sort(key=lambda item: (item.interface_number if item.interface_number is not None else 9999, item.path))

    for index, device in enumerate(devices):
        device.index = index

    return devices


def print_devices(devices: List[HidDeviceInfo], as_json: bool) -> None:
    if as_json:
        payload = [
            {
                "index": item.index,
                "path": item.path,
                "vendorId": f"0x{item.vendor_id:04X}",
                "productId": f"0x{item.product_id:04X}",
                "usagePage": f"0x{(item.usage_page or 0):04X}",
                "usage": f"0x{(item.usage or 0):02X}",
                "interfaceNumber": item.interface_number,
                "manufacturer": item.manufacturer_string,
                "product": item.product_string,
                "serial": item.serial_number,
            }
            for item in devices
        ]
        print(json.dumps(payload, indent=2))
        return

    if not devices:
        print("No matching RAW HID devices found.")
        return

    print("Matching RAW HID devices:")
    for item in devices:
        print(
            f"[{item.index}] path={item.path} vid=0x{item.vendor_id:04X} pid=0x{item.product_id:04X} "
            f"usagePage=0x{(item.usage_page or 0):04X} usage=0x{(item.usage or 0):02X} "
            f"interface={item.interface_number} product='{item.product_string}'"
        )


def select_device(devices: List[HidDeviceInfo], index: int, path: str) -> HidDeviceInfo:
    if path:
        for device in devices:
            if device.path == path:
                return device
        raise RuntimeError(f"no matching device path: {path}")

    if not devices:
        raise RuntimeError("no matching RAW HID device found")

    if index < 0 or index >= len(devices):
        raise RuntimeError(f"device index {index} is out of range (0..{len(devices) - 1})")

    return devices[index]


def write_packet(device: Any, payload: List[int]) -> None:
    packet = [0] * (RAW_EPSIZE + 1)
    for idx, value in enumerate(payload[:RAW_EPSIZE]):
        packet[idx + 1] = value & 0xFF

    written = device.write(packet)
    if written <= 0:
        raise RuntimeError("failed to write HID packet")


def read_packet(device: Any, timeout_ms: int) -> List[int]:
    data = device.read(RAW_EPSIZE + 1, timeout_ms)
    if not data:
        raise TimeoutError(f"no response received within {timeout_ms}ms")

    values = list(data)
    if len(values) == RAW_EPSIZE + 1 and values[0] == 0:
        values = values[1:]

    if len(values) < RAW_EPSIZE:
        values += [0] * (RAW_EPSIZE - len(values))

    return values[:RAW_EPSIZE]


def expect_ack(response: List[int], command: int) -> None:
    response_command = response[0]
    response_status = response[1]

    if response_command != command:
        raise RuntimeError(f"unexpected ack command byte: expected 0x{command:02X}, got 0x{response_command:02X}")
    if response_status != STATUS_OK:
        raise RuntimeError(f"device returned non-ok status: 0x{response_status:02X}")


def run() -> int:
    parser = argparse.ArgumentParser(description="QMK RAW HID notifier utility")
    parser.add_argument("--vid", default="0x7807", help="USB vendor ID (default: 0x7807)")
    parser.add_argument("--pid", default="0xDCCB", help="USB product ID (default: 0xDCCB)")
    parser.add_argument("--usage-page", default="0xFF60", help="HID usage page (default: 0xFF60)")
    parser.add_argument("--usage", default="0x61", help="HID usage ID (default: 0x61)")
    parser.add_argument("--index", type=int, default=0, help="device index from --list output")
    parser.add_argument("--path", default="", help="explicit HID path to use")
    parser.add_argument("--timeout-ms", type=int, default=3000, help="read timeout in ms")
    parser.add_argument("--list", action="store_true", help="list matching RAW HID devices")
    parser.add_argument("--json", action="store_true", help="emit JSON output where applicable")
    parser.add_argument("--ping", action="store_true", help="send ping command")
    parser.add_argument("--flash", action="store_true", help="send flash command")
    parser.add_argument("--rgb", action="store_true", help="send direct RGB command")
    parser.add_argument("--rgb-at", action="store_true", help="send direct RGB command to one LED index")
    parser.add_argument("--led-index", type=int, default=0, help="LED index for --rgb-at (0-based)")
    parser.add_argument("--hue", type=int, default=0, help="flash hue (0-255)")
    parser.add_argument("--sat", type=int, default=255, help="flash saturation (0-255)")
    parser.add_argument("--val", type=int, default=160, help="flash value/brightness (0-255)")
    parser.add_argument("--red", type=int, default=255, help="direct red channel (0-255)")
    parser.add_argument("--green", type=int, default=0, help="direct green channel (0-255)")
    parser.add_argument("--blue", type=int, default=0, help="direct blue channel (0-255)")
    parser.add_argument("--duration-ms", type=int, default=800, help="flash duration in ms (100-5000)")
    parser.add_argument("--reason", default="", help="optional reason label for logs")
    parser.add_argument("--dry-run", action="store_true", help="print command payload without sending")
    args = parser.parse_args()

    try:
        vid = parse_int_auto(args.vid)
        pid = parse_int_auto(args.pid)
        usage_page = parse_int_auto(args.usage_page)
        usage = parse_int_auto(args.usage)
    except ValueError as exc:
        print(f"ERROR: invalid numeric argument: {exc}", file=sys.stderr)
        return 2

    timeout_ms = clamp(int(args.timeout_ms), 100, 120000)
    hue = clamp(int(args.hue), 0, 255)
    sat = clamp(int(args.sat), 0, 255)
    val = clamp(int(args.val), 0, 255)
    red = clamp(int(args.red), 0, 255)
    green = clamp(int(args.green), 0, 255)
    blue = clamp(int(args.blue), 0, 255)
    led_index = clamp(int(args.led_index), 0, 255)
    duration_ms = clamp(int(args.duration_ms), 100, 60000)

    if not args.list and not args.ping and not args.flash and not args.rgb and not args.rgb_at:
        print("ERROR: choose at least one action: --list, --ping, --flash, --rgb, or --rgb-at", file=sys.stderr)
        return 2

    hid = load_hid_module()
    devices = enumerate_candidates(hid, vid, pid, usage_page, usage)

    if args.list:
        print_devices(devices, args.json)
        if not args.ping and not args.flash:
            return 0

    try:
        device_info = select_device(devices, args.index, args.path)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 3

    if args.dry_run:
        payload = {
            "device": {
                "index": device_info.index,
                "path": device_info.path,
                "vid": f"0x{device_info.vendor_id:04X}",
                "pid": f"0x{device_info.product_id:04X}",
                "usagePage": f"0x{(device_info.usage_page or 0):04X}",
                "usage": f"0x{(device_info.usage or 0):02X}",
            },
            "actions": {
                "ping": bool(args.ping),
                "flash": bool(args.flash),
                "rgb": bool(args.rgb),
                "rgbAt": bool(args.rgb_at),
                "hue": hue,
                "sat": sat,
                "val": val,
                "red": red,
                "green": green,
                "blue": blue,
                "ledIndex": led_index,
                "durationMs": duration_ms,
                "reason": args.reason,
                "timeoutMs": timeout_ms,
            },
        }
        print(json.dumps(payload, indent=2))
        return 0

    device = hid.device()
    try:
        device.open_path(normalize_path_for_open(device_info.raw_path))

        if args.ping:
            write_packet(device, [CMD_PING])
            response = read_packet(device, timeout_ms)
            expect_ack(response, CMD_PING)

        if args.flash:
            write_packet(
                device,
                [
                    CMD_FLASH,
                    hue,
                    sat,
                    val,
                    duration_ms & 0xFF,
                    (duration_ms >> 8) & 0xFF,
                ],
            )
            response = read_packet(device, timeout_ms)
            expect_ack(response, CMD_FLASH)

        if args.rgb:
            write_packet(
                device,
                [
                    CMD_RGB,
                    red,
                    green,
                    blue,
                    duration_ms & 0xFF,
                    (duration_ms >> 8) & 0xFF,
                ],
            )
            response = read_packet(device, timeout_ms)
            expect_ack(response, CMD_RGB)

        if args.rgb_at:
            write_packet(
                device,
                [
                    CMD_RGB_AT,
                    led_index,
                    red,
                    green,
                    blue,
                    duration_ms & 0xFF,
                    (duration_ms >> 8) & 0xFF,
                ],
            )
            response = read_packet(device, timeout_ms)
            expect_ack(response, CMD_RGB_AT)

    except TimeoutError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 5
    except Exception as exc:
        print(f"ERROR: HID command failed: {exc}", file=sys.stderr)
        return 4
    finally:
        try:
            device.close()
        except Exception:
            pass

    if args.json:
        print(
            json.dumps(
                {
                    "ok": True,
                    "device": {
                        "index": device_info.index,
                        "path": device_info.path,
                        "vid": f"0x{device_info.vendor_id:04X}",
                        "pid": f"0x{device_info.product_id:04X}",
                    },
                    "actions": {
                        "ping": bool(args.ping),
                        "flash": bool(args.flash),
                        "rgb": bool(args.rgb),
                        "rgbAt": bool(args.rgb_at),
                        "hue": hue,
                        "sat": sat,
                        "val": val,
                        "red": red,
                        "green": green,
                        "blue": blue,
                        "ledIndex": led_index,
                        "durationMs": duration_ms,
                        "reason": args.reason,
                    },
                },
                indent=2,
            )
        )
    else:
        action_parts = []
        if args.ping:
            action_parts.append("ping")
        if args.flash:
            action_parts.append("flash")
        if args.rgb:
            action_parts.append("rgb")
        if args.rgb_at:
            action_parts.append(f"rgb-at:{led_index}")
        action = "+".join(action_parts) if action_parts else "none"
        print(f"OK: {action} sent to {device_info.path}")

    return 0


if __name__ == "__main__":
    sys.exit(run())
