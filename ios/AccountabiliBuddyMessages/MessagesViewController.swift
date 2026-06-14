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
        Task { await viewModel.openFromIncomingURL(conversation.selectedMessage?.url) }
    }

    override func didSelect(_ message: MSMessage, conversation: MSConversation) {
        super.didSelect(message, conversation: conversation)
        Task { await viewModel.openFromIncomingURL(message.url) }
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
                self.viewModel.infoMessage = "Bet card inserted into the conversation."
            }
        }
    }
}
