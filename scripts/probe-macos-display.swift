// 只读macOS显示模式枚举：不创建窗口、不选择模式、不调整系统配置。
// Windows准备阶段尚未编译；首次Mac编译/运行结果必须由独立诊断CI原件证明。
import AppKit
import CoreGraphics
import Foundation
import Darwin

/** 明确拒绝参数和不完整结果；错误只写通用说明，不输出环境或设备序列号。 */
func fail(_ message: String, code: Int32 = 78) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

/** 保留AppKit点坐标及原点；不将其直接当作Electron坐标或像素。 */
func rectangle(_ value: NSRect) -> [String: Double] {
    let fields = ["x": Double(value.origin.x), "y": Double(value.origin.y),
                  "width": Double(value.size.width), "height": Double(value.size.height)]
    guard fields.values.allSatisfy({ $0.isFinite }), value.width >= 0, value.height >= 0 else {
        fail("系统返回了无效显示矩形")
    }
    return fields
}

/** 模式逻辑尺寸、实际像素和两者比例同时保留，不能仅据像素数证明可用DIP空间。 */
func describeMode(_ value: CGDisplayMode) -> [String: Any] {
    guard value.width > 0, value.height > 0, value.pixelWidth > 0, value.pixelHeight > 0,
          value.refreshRate.isFinite, value.refreshRate >= 0 else { fail("系统返回了无效显示模式") }
    return ["modeID": value.ioDisplayModeID,
            "logicalWidth": value.width, "logicalHeight": value.height,
            "pixelWidth": value.pixelWidth, "pixelHeight": value.pixelHeight,
            "pixelToLogicalScaleX": Double(value.pixelWidth) / Double(value.width),
            "pixelToLogicalScaleY": Double(value.pixelHeight) / Double(value.height),
            "refreshRate": value.refreshRate, "ioFlags": value.ioFlags]
}

// 参数门先于任何显示器访问；没有apply、切换、隐藏窗口或调试入口。
guard CommandLine.arguments.count == 1 else { fail("本工具仅允许无参数只读枚举", code: 64) }
#if !arch(arm64)
fail("本诊断仅面向macos-latest的arm64上下文")
#endif

let screens = NSScreen.screens
guard !screens.isEmpty, screens.count <= 16 else { fail("活动显示器缺失或超过16个的枚举预算") }
var displays: [[String: Any]] = []
var seen = Set<CGDirectDisplayID>()
// 官方公开选项包含重复的低分辨率模式，不去重、过滤或替系统制造模式。
let options = [kCGDisplayShowDuplicateLowResolutionModes as String: true] as CFDictionary
for screen in screens {
    guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
        fail("无法将NSScreen对应到实际显示器")
    }
    let display = CGDirectDisplayID(number.uint32Value)
    guard seen.insert(display).inserted, CGDisplayIsActive(display) != 0,
          let current = CGDisplayCopyDisplayMode(display),
          let modes = CGDisplayCopyAllDisplayModes(display, options) as? [CGDisplayMode],
          !modes.isEmpty, modes.count <= 4096 else { fail("活动显示器或完整模式列表未知，未输出截断清单") }
    let scale = Double(screen.backingScaleFactor)
    guard scale.isFinite, scale > 0 else { fail("显示器缩放比例未知") }
    displays.append(["displayID": display, "mainDisplay": display == CGMainDisplayID(),
                     "framePoints": rectangle(screen.frame),
                     "visibleFramePoints": rectangle(screen.visibleFrame),
                     "backingScaleFactor": scale,
                     "currentMode": describeMode(current), "availableModeCount": modes.count,
                     "availableModes": modes.map(describeMode)])
}

// 仅取两个明确的runner镜像字段；不输出整个环境、显示器名称、UUID或序列号。
let environment = ProcessInfo.processInfo.environment
let context: [String: Any] = ["architecture": "arm64",
                            "operatingSystemVersion": ProcessInfo.processInfo.operatingSystemVersionString,
                            "imageOS": environment["ImageOS"] ?? "未知",
                            "imageVersion": environment["ImageVersion"] ?? "未知",
                            "swVersContextFile": "context.log"]
let payload: [String: Any] = ["schemaVersion": 1, "readOnly": true,
                            "用途": "只读枚举，不代表显示空间足够或产品原生验收通过",
                            "尺寸说明": "logical来自CGDisplayMode，AppKit矩形为点，pixel为实际像素；仍须未来读取Electron原窗口及workArea DIP",
                            "includesDuplicateLowResolutionModes": true,
                            "context": context, "displays": displays]
let data: Data
do { data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]) }
catch { fail("显示枚举JSON序列化失败") }
guard data.count <= 8 * 1024 * 1024 else { fail("完整枚举超过8MiB预算，未输出截断清单") }
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
