// 候选实现：当前仅供Root审阅，尚未在Mac编译/运行；无窗口或应用强停入口。
import AppKit
import CoreGraphics
import Foundation
import Darwin

let args = CommandLine.arguments
// 无默认执行入口，非法参数必须先于任何AppKit/CoreGraphics访问拒绝。
guard args.count == 4, args[1] == "--hold", args[2] == "600",
      args[3].range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
    FileHandle.standardError.write(Data("仅接受--hold 600及64位小写十六进制nonce\n".utf8)); exit(64)
}
#if !arch(arm64)
FileHandle.standardError.write(Data("本候选仅面向arm64\n".utf8)); exit(78)
#endif
let nonce = args[3], deadline = ProcessInfo.processInfo.systemUptime + 600
var seq = 0, retained = false, failureDeadline = deadline

/** 只发送本进程的有序JSON帧，不输出环境、设备名称、UUID或序列号。 */
func emit(_ type: String, _ payload: [String: Any] = [:]) {
    seq += 1
    var value = payload; value["type"] = type; value["nonce"] = nonce; value["seq"] = seq
    guard let bytes = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), bytes.count <= 2 * 1024 * 1024 else { exit(78) }
    FileHandle.standardOutput.write(bytes); FileHandle.standardOutput.write(Data("\n".utf8))
}
/** 失败后只保留已持有的内存并等待有界自退；不再读显示SDK或显式改模式。 */
func retain(_ reason: String) {
    if !retained { retained = true; failureDeadline = min(deadline, ProcessInfo.processInfo.systemUptime + 15); emit("failed", ["reason": reason, "automaticRestoration": "进程退出后按forAppOnly文档预期回到登录会话配置，未实测确认", "applicationForceStop": false]) }
}
func active() throws {
    if retained || ProcessInfo.processInfo.systemUptime >= deadline { throw NSError(domain: "租约失效", code: 1) }
}
/** 模式对象的getter也消费原期限，避免遍历大列表时跨期继续读取。 */
func read<T>(_ action: () -> T) throws -> T { try active(); let value = action(); try active(); return value }
/** 原始点坐标与模式两套尺寸同时保留，不将像素数冒充DIP空间。 */
func rectangle(_ value: NSRect) -> [String: Double] { ["x": Double(value.origin.x), "y": Double(value.origin.y), "width": Double(value.width), "height": Double(value.height)] }
func mode(_ value: CGDisplayMode) throws -> [String: Any] {
    let id = try read { value.ioDisplayModeID }, width = try read { value.width }, height = try read { value.height }
    let pixelsWide = try read { value.pixelWidth }, pixelsHigh = try read { value.pixelHeight }
    let rate = try read { value.refreshRate }, flags = try read { value.ioFlags }
    guard width > 0, height > 0, pixelsWide > 0, pixelsHigh > 0, rate.isFinite, rate >= 0 else { throw NSError(domain: "模式字段无效", code: 1) }
    return ["modeID": id, "logicalWidth": width, "logicalHeight": height,
            "pixelWidth": pixelsWide, "pixelHeight": pixelsHigh,
            "pixelToLogicalScaleX": Double(pixelsWide) / Double(width),
            "pixelToLogicalScaleY": Double(pixelsHigh) / Double(height), "refreshRate": rate, "ioFlags": flags]
}
/** 每次仅支持一个活动、非镜像、scale1的主显示器；未知拓扑不做配置。 */
func snapshot() throws -> (data: [String: Any], display: CGDirectDisplayID, current: CGDisplayMode, modes: [CGDisplayMode]) {
    try active(); let screens = NSScreen.screens; try active()
    guard screens.count == 1, let screen = screens.first else { throw NSError(domain: "显示拓扑未知", code: 1) }
    guard let number = (try read { screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] }) as? NSNumber else { throw NSError(domain: "显示身份未知", code: 1) }
    let display = CGDirectDisplayID(number.uint32Value)
    try active(); let main = CGMainDisplayID(); try active()
    let enabled = CGDisplayIsActive(display); try active()
    let mirrored = CGDisplayIsInMirrorSet(display); try active()
    guard display == main, enabled != 0, mirrored == 0 else { throw NSError(domain: "活动主显示器或镜像关系未知", code: 1) }
    let current = CGDisplayCopyDisplayMode(display); try active()
    let list = CGDisplayCopyAllDisplayModes(display, [kCGDisplayShowDuplicateLowResolutionModes as String: true] as CFDictionary); try active()
    let frame = screen.frame; try active(); let visible = screen.visibleFrame; try active(); let scale = screen.backingScaleFactor; try active()
    guard let current, let modes = list as? [CGDisplayMode], !modes.isEmpty, modes.count <= 4096,
          scale == 1,
          [frame.width, frame.height, visible.width, visible.height].allSatisfy({ $0.isFinite && $0 > 0 }) else { throw NSError(domain: "尺寸单位或模式列表未知", code: 1) }
    let currentData = try mode(current), modesData = try modes.map(mode)
    guard frame.width == CGFloat(currentData["logicalWidth"] as! Int), frame.height == CGFloat(currentData["logicalHeight"] as! Int) else { throw NSError(domain: "模式与点坐标对应未知", code: 1) }
    let environment = ProcessInfo.processInfo.environment
    guard environment["ImageOS"] == "macos26", environment["ImageVersion"] == "20261013.0424.1" else { throw NSError(domain: "原镜像已变化，须先重新枚举审阅", code: 1) }
    let data: [String: Any] = ["context": ["architecture": "arm64", "imageOS": environment["ImageOS"]!, "imageVersion": environment["ImageVersion"]!], "displays": [["displayID": display, "mainDisplay": true, "mirrored": false, "framePoints": rectangle(frame), "visibleFramePoints": rectangle(visible), "backingScaleFactor": scale, "currentMode": currentData, "availableModeCount": modes.count, "availableModes": modesData]]]
    return (data, display, current, modes)
}
/** 只改当前进程作用域；configure失败仅取消尚未提交的自有事务，不重试或转永久配置。 */
func configure(_ display: CGDirectDisplayID, _ selected: CGDisplayMode) throws {
    try active(); var token: CGDisplayConfigRef?
    let begin = CGBeginDisplayConfiguration(&token)
    guard begin == .success, token != nil else { throw NSError(domain: "创建显示事务失败", code: Int(begin.rawValue)) }
    var pending = true
    // 仅释放尚未提交的自有事务；complete调用后不复用其token，不尝试补偿未知提交。
    defer { if pending { _ = CGCancelDisplayConfiguration(token) } }
    try active()
    let configured = CGConfigureDisplayWithDisplayMode(token, display, selected, nil)
    if configured != .success { throw NSError(domain: "配置系统模式失败", code: Int(configured.rawValue)) }
    try active(); pending = false
    let completed = CGCompleteDisplayConfiguration(token, .forAppOnly); try active()
    guard completed == .success else { throw NSError(domain: "提交临时模式失败", code: Int(completed.rawValue)) }
}
/** 最多5秒只读等待两次相同真实模式/矩形，不重复apply；到期不补读。 */
func stable(_ display: CGDirectDisplayID, _ selected: CGDisplayMode, requireSpace: Bool) throws -> [String: Any] {
    let until = min(deadline, ProcessInfo.processInfo.systemUptime + 5); var previous: Data?
    while ProcessInfo.processInfo.systemUptime < until {
        let value = try snapshot()
        guard value.display == display else { throw NSError(domain: "原显示器已替换", code: 1) }
        let screens = value.data["displays"] as! [[String: Any]], visible = screens[0]["visibleFramePoints"] as! [String: Double]
        let sameMode = NSDictionary(dictionary: try mode(value.current)).isEqual(to: try mode(selected))
        let valid = sameMode && (!requireSpace || visible["width"]! >= 1440 && visible["height"]! >= 1100)
        let bytes = try JSONSerialization.data(withJSONObject: value.data, options: [.sortedKeys])
        if valid && previous == bytes { return value.data }; previous = valid ? bytes : nil
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1)); try active()
    }
    throw NSError(domain: "原模式或真实可见区域未稳定", code: 1)
}

var before: (data: [String: Any], display: CGDirectDisplayID, current: CGDisplayMode, modes: [CGDisplayMode])?
do { before = try snapshot(); emit("inventory", ["snapshot": before!.data]) } catch { retain("首次只读显示证明失败") }
var selected: CGDisplayMode?, applied = false, input = Data(), lastPulse = ProcessInfo.processInfo.systemUptime
while ProcessInfo.processInfo.systemUptime < (retained ? failureDeadline : deadline) {
    if !retained && applied && ProcessInfo.processInfo.systemUptime - lastPulse >= 1 {
        do { let value = try stable(before!.display, selected!, requireSpace: true); emit("pulse", ["snapshot": value]); lastPulse = ProcessInfo.processInfo.systemUptime }
        catch { retain("保有期间显示证明失效") }
    }
    // 只读stdin协议；EOF/坏帧永久失败，不把父进程消失解释为正常释放。
    var descriptor = pollfd(fd: STDIN_FILENO, events: Int16(POLLIN | POLLHUP), revents: 0)
    let result = poll(&descriptor, 1, 100)
    if result < 0 { retain("输入通道失败"); continue }
    if result == 0 { continue }
    var buffer = [UInt8](repeating: 0, count: 512)
    let count = buffer.withUnsafeMutableBytes { Darwin.read(STDIN_FILENO, $0.baseAddress, $0.count) }
    if count <= 0 { retain("父通道关闭"); usleep(100_000); continue }
    input.append(contentsOf: buffer.prefix(count))
    if input.count > 4096 { retain("输入帧超预算"); input.removeAll(); continue }
    while let newline = input.firstIndex(of: 10) {
        let bytes = input.prefix(upTo: newline); input.removeSubrange(...newline)
        guard !retained, let command = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any],
              command["nonce"] as? String == nonce, let action = command["action"] as? String else { retain("输入帧归属或状态错误"); continue }
        if action == "retain", Set(command.keys) == ["action", "nonce"] { retain("父控制器保留原失败"); continue }
        do {
            if action == "apply", !applied, Set(command.keys) == ["action", "nonce", "modeID"], let id = command["modeID"] as? UInt32, let original = before {
                let fresh = try snapshot()
                guard fresh.display == original.display, NSDictionary(dictionary: fresh.data).isEqual(to: original.data) else { throw NSError(domain: "原枚举已变", code: 1) }
                let matches = try fresh.modes.filter { value in try read { value.ioDisplayModeID } == id }
                guard matches.count == 1 else { throw NSError(domain: "模式不在当次唯一系统列表", code: 1) }
                let target = matches[0], targetData = try mode(target)
                let width = targetData["logicalWidth"] as! Int, height = targetData["logicalHeight"] as! Int
                guard targetData["pixelWidth"] as! Int == width, targetData["pixelHeight"] as! Int == height, targetData["refreshRate"] as! Double == 60 else { throw NSError(domain: "模式尺寸或频率未知", code: 1) }
                let screen = (fresh.data["displays"] as! [[String: Any]])[0], frame = screen["framePoints"] as! [String: Double], visible = screen["visibleFramePoints"] as! [String: Double]
                guard Double(width) - (frame["width"]! - visible["width"]!) >= 1440,
                      Double(height) - (frame["height"]! - visible["height"]!) >= 1100 else { throw NSError(domain: "候选可见余量不足", code: 1) }
                selected = target; try configure(fresh.display, target); applied = true
                let value = try stable(fresh.display, target, requireSpace: true); emit("ready", ["snapshot": value])
            } else if action == "release", applied, Set(command.keys) == ["action", "nonce"], let original = before {
                // 仅由父控制器在原native成功且两owner证明闭合后发送；失败后永不进入本分支。
                _ = try stable(original.display, selected!, requireSpace: true)
                let fresh = try snapshot()
                let originalData = try mode(original.current)
                let originals = try fresh.modes.filter { NSDictionary(dictionary: try mode($0)).isEqual(to: originalData) }
                guard fresh.display == original.display, originals.count == 1 else { throw NSError(domain: "原模式已不在当次系统列表", code: 1) }
                try configure(original.display, originals[0])
                let value = try stable(original.display, originals[0], requireSpace: false)
                emit("restored", ["snapshot": value, "originalModeRestoredBeforeExit": true, "postExitRestorationObserved": false]); exit(0)
            } else { retain("命令或阶段错误") }
        } catch { retain("系统事务或原模式证明失败") }
    }
}
if !retained { retain("原600秒租约届满") }
// 不执行新的SDK读写；仅本keeper自退，OS按forAppOnly文档恢复当前会话配置，结果未补探测。
exit(78)
