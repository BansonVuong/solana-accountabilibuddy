import Messages
import SwiftUI
import UIKit

final class MessagesViewController: MSMessagesAppViewController {
    private let viewModel = BetMessageViewModel()
    private var hostingController: UIHostingController<BetMessageRootView>?

    override func viewDidLoad() {
        super.viewDidLoad()
        installRootView()
    }

    override func willBecomeActive(with conversation: MSConversation) {
        super.willBecomeActive(with: conversation)
        openSelectedMessage(in: conversation, source: "willActive")
    }

    override func didSelect(_ message: MSMessage, conversation: MSConversation) {
        super.didSelect(message, conversation: conversation)
        requestPresentationStyle(.expanded)
        openSelectedMessage(message, in: conversation, source: "didSelect")
    }

    override func didTransition(to presentationStyle: MSMessagesAppPresentationStyle) {
        super.didTransition(to: presentationStyle)
        guard presentationStyle == .expanded, let conversation = activeConversation else { return }
        openSelectedMessage(in: conversation, source: "didTransition")
    }

    private func openSelectedMessage(_ message: MSMessage? = nil, in conversation: MSConversation, source: String) {
        let selected = conversation.selectedMessage
        let url = message?.url ?? selected?.url
        let caption = ((message?.layout ?? selected?.layout) as? MSMessageTemplateLayout)?.caption ?? "—"
        Task {
            await viewModel.setDebug("[\(source)] url=\(url?.absoluteString ?? "nil") sel=\(selected != nil) cap=\(caption)")
            await updateParticipants(from: conversation)
            // Don't let an empty willActive/didTransition callback wipe a URL we already routed.
            guard url != nil else { return }
            await viewModel.openFromIncomingURL(url)
        }
    }

    private func updateParticipants(from conversation: MSConversation) async {
        await viewModel.updateConversationParticipants(
            local: conversation.localParticipantIdentifier.uuidString,
            remote: conversation.remoteParticipantIdentifiers.map(\.uuidString)
        )
    }

    private func installRootView() {
        let root = BetMessageRootView(viewModel: viewModel) { [weak self] draft in
            self?.insertMessageDraft(draft)
        }
        let host = UIHostingController(rootView: root)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        addChild(host)
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        host.didMove(toParent: self)
        hostingController = host
    }

    private func insertMessageDraft(_ draft: BetDraftMessage) {
        guard let conversation = activeConversation else {
            viewModel.errorMessage = "No active iMessage conversation."
            return
        }

        let layout = MSMessageTemplateLayout()
        layout.image = cardImage(for: draft)
        layout.caption = draft.title
        layout.subcaption = draft.subtitle
        layout.trailingCaption = draft.footnote
        layout.trailingSubcaption = draft.action

        let session = conversation.selectedMessage?.session ?? MSSession()
        let message = MSMessage(session: session)
        message.layout = layout
        message.url = draft.url

        conversation.insert(message) { [weak self] error in
            guard let self else { return }
            Task { @MainActor in
                if let error {
                    self.viewModel.errorMessage = "Failed to insert iMessage: \(error.localizedDescription)"
                    return
                }
                self.viewModel.infoMessage = "Card inserted into the conversation."
            }
        }
    }

    private func cardImage(for draft: BetDraftMessage) -> UIImage {
        let size = CGSize(width: 600, height: 360)
        let renderer = UIGraphicsImageRenderer(size: size)

        return renderer.image { context in
            let colors: [CGColor]
            let accent: UIColor

            switch draft.kind {
            case .bet:
                colors = [
                    UIColor(red: 0.08, green: 0.06, blue: 0.18, alpha: 1).cgColor,
                    UIColor(red: 0.24, green: 0.10, blue: 0.42, alpha: 1).cgColor
                ]
                accent = UIColor(red: 0.66, green: 0.43, blue: 1, alpha: 1)
            case .invite:
                colors = [
                    UIColor(red: 0.03, green: 0.13, blue: 0.18, alpha: 1).cgColor,
                    UIColor(red: 0.02, green: 0.35, blue: 0.35, alpha: 1).cgColor
                ]
                accent = UIColor(red: 0.26, green: 0.91, blue: 0.82, alpha: 1)
            }

            let gradient = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(),
                colors: colors as CFArray,
                locations: [0, 1]
            )!
            context.cgContext.drawLinearGradient(
                gradient,
                start: .zero,
                end: CGPoint(x: size.width, y: size.height),
                options: []
            )

            context.cgContext.setFillColor(accent.withAlphaComponent(0.14).cgColor)
            context.cgContext.fillEllipse(in: CGRect(x: 390, y: -130, width: 340, height: 340))
            context.cgContext.fillEllipse(in: CGRect(x: -120, y: 250, width: 270, height: 270))

            drawPill(draft.eyebrow, at: CGPoint(x: 36, y: 34), accent: accent)
            drawText(
                draft.title,
                in: CGRect(x: 36, y: 105, width: 528, height: 62),
                font: .systemFont(ofSize: 34, weight: .bold),
                color: .white
            )
            drawText(
                draft.subtitle,
                in: CGRect(x: 36, y: 172, width: 528, height: 72),
                font: .systemFont(ofSize: 21, weight: .medium),
                color: UIColor.white.withAlphaComponent(0.76)
            )

            let highlightRect = CGRect(x: 36, y: 270, width: 528, height: 58)
            UIColor.white.withAlphaComponent(0.10).setFill()
            UIBezierPath(roundedRect: highlightRect, cornerRadius: 18).fill()
            drawText(
                draft.highlight,
                in: highlightRect.insetBy(dx: 18, dy: 10),
                font: .monospacedDigitSystemFont(ofSize: 27, weight: .bold),
                color: accent
            )
        }
    }

    private func drawPill(_ text: String, at origin: CGPoint, accent: UIColor) {
        let attributes: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: 16, weight: .bold),
            .foregroundColor: accent
        ]
        let textSize = (text as NSString).size(withAttributes: attributes)
        let rect = CGRect(x: origin.x, y: origin.y, width: textSize.width + 28, height: 36)
        accent.withAlphaComponent(0.16).setFill()
        UIBezierPath(roundedRect: rect, cornerRadius: 18).fill()
        (text as NSString).draw(at: CGPoint(x: rect.minX + 14, y: rect.minY + 8), withAttributes: attributes)
    }

    private func drawText(_ text: String, in rect: CGRect, font: UIFont, color: UIColor) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        (text as NSString).draw(
            with: rect,
            options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine],
            attributes: [
                .font: font,
                .foregroundColor: color,
                .paragraphStyle: paragraph
            ],
            context: nil
        )
    }
}
