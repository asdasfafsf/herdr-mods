// HerdrNotify: mac-notify mod 가 macOS 알림 센터 배너를 띄울 때 쓰는 작은 앱.
//
// osascript 의 display notification 은 "스크립트 편집기" 이름·아이콘으로 뜨고, 눌러도 아무 데도
// 가지 않는다. 배너의 왼쪽 아이콘은 보낸 앱의 아이콘이라, Herdr 아이콘을 단 앱이 직접 보내게 한다.
// Herdr 앱 자체에는 macOS 알림 기능이 없어서, 이 앱이 "Herdr" 라는 표시 이름으로 대신 보낸다
// (bundle id 는 local.herdr-mods.notify 로 진짜 Herdr(dev.herdr.app) 와 다르다).
//
// 두 가지로 실행된다.
//   1. mod 가 인자를 주고 실행:  HerdrNotify --title T [--subtitle S] [--body B] [--terminal t9] [--group G]
//      배너 하나를 올리고 바로 끝난다. 종료 코드 0 = 올림, 1 = 올리기 실패, 2 = 알림 미허용, 3 = 시간 초과.
//      처음 실행하면 macOS 가 알림 허용을 묻는다 (허용 전까지 기다리다 시간 초과로 끝날 수 있다).
//   2. 배너를 눌러서 macOS 가 인자 없이 실행: 그 배너의 terminal 로 `herdr-app do agent.focus` 를 부르고
//      Herdr 를 앞으로 가져온 뒤 끝난다.
// 화면도 Dock 아이콘도 없다 (LSUIElement). 빌드·설치는 같은 폴더의 build.sh.

import AppKit
import UserNotifications

let herdrBundleID = "dev.herdr.app"

func parseArgs(_ argv: [String]) -> [String: String] {
    var out: [String: String] = [:]
    var i = 1
    while i < argv.count {
        let key = argv[i]
        if key.hasPrefix("--"), i + 1 < argv.count {
            out[String(key.dropFirst(2))] = argv[i + 1]
            i += 2
        } else {
            i += 1  // LaunchServices 가 붙이는 -psn_… 같은 것은 무시
        }
    }
    return out
}

func fail(_ code: Int32, _ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

func herdrAppURL() -> URL? {
    NSWorkspace.shared.urlForApplication(withBundleIdentifier: herdrBundleID)
}

// herdr-app CLI 는 Herdr.app 안의 실행 파일 그 자체다 (~/.local/bin/herdr-app 도 그 링크).
// 배너 클릭으로 실행되면 PATH 가 사용자 셸의 것이 아니므로 앱 위치로 찾는다.
func runHerdr(_ args: [String]) {
    guard let app = herdrAppURL() else { return }
    let p = Process()
    p.executableURL = app.appendingPathComponent("Contents/MacOS/Herdr")
    p.arguments = args
    p.standardOutput = FileHandle.nullDevice
    p.standardError = FileHandle.nullDevice
    do {
        try p.run()
        p.waitUntilExit()
    } catch {}
}

func activateHerdr(then done: @escaping () -> Void) {
    guard let app = herdrAppURL() else { return done() }
    let config = NSWorkspace.OpenConfiguration()
    config.activates = true
    NSWorkspace.shared.openApplication(at: app, configuration: config) { _, _ in
        DispatchQueue.main.async(execute: done)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    let args = parseArgs(CommandLine.arguments)

    // 배너 클릭 응답은 실행 직후 delegate 로 온다. 그 전에 delegate 를 달아 둬야 한다.
    func applicationWillFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let title = args["title"] {
            // Herdr 의 exec 는 30초 제한이 있다. 허용 질문에 답이 없으면 그 전에 스스로 끝낸다.
            DispatchQueue.main.asyncAfter(deadline: .now() + 25) {
                fail(3, "시간 초과 (알림 허용 질문에 아직 답하지 않았을 수 있어요)")
            }
            post(title: title)
        } else {
            // 배너 클릭이면 곧 didReceive 가 온다. 안 오면 (그냥 열었을 때) 잠시 뒤 끝낸다.
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { NSApp.terminate(nil) }
        }
    }

    func post(title: String) {
        let center = UNUserNotificationCenter.current()
        // 소리는 넣지 않는다: Herdr 가 이미 done/blocked 소리를 낸다.
        center.requestAuthorization(options: [.alert]) { granted, error in
            guard granted else {
                fail(2, "알림이 허용되지 않았어요" + (error.map { ": \($0.localizedDescription)" } ?? ""))
            }
            let content = UNMutableNotificationContent()
            content.title = title
            content.subtitle = self.args["subtitle"] ?? ""
            content.body = self.args["body"] ?? ""
            if let terminal = self.args["terminal"], !terminal.isEmpty {
                content.userInfo = ["terminal": terminal]
            }
            if let group = self.args["group"], !group.isEmpty {
                content.threadIdentifier = group
            }
            let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
            center.add(request) { error in
                if let error { fail(1, "알림을 올리지 못했어요: \(error.localizedDescription)") }
                exit(0)
            }
        }
    }

    // 이 앱이 앞에 있을 일은 거의 없지만, 그때도 배너를 보인다.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if let terminal = response.notification.request.content.userInfo["terminal"] as? String {
            runHerdr(["do", "agent.focus", "--terminal", terminal])
        }
        completionHandler()
        activateHerdr { NSApp.terminate(nil) }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
