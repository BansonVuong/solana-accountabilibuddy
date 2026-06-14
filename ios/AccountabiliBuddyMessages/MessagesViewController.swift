import Messages
import SwiftUI

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
        layout.caption = draft.title
        layout.subcaption = draft.subtitle
        if let balance = draft.solBalance {
            layout.trailingCaption = String(format: "%.4f SOL", balance)
        }
        if let wallet = draft.wallet {
            layout.trailingSubcaption = "\(wallet.prefix(6))...\(wallet.suffix(6))"
        }

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
}
