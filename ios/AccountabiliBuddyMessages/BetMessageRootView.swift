import SwiftUI

struct BetMessageRootView: View {
    @ObservedObject var viewModel: BetMessageViewModel
    let onSendDraft: (BetDraftMessage) -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if viewModel.isSignedIn {
                    accountCard
                    conversationCard
                    if viewModel.conversation != nil {
                        composeCard
                    }
                    selectedBetCard
                } else {
                    authenticationCard
                }
                feedbackStrip
            }
            .padding(12)
        }
        .background(Color(.systemGroupedBackground))
        .task {
            await viewModel.bootstrap()
        }
        .task(id: viewModel.conversation?.id) {
            guard viewModel.conversation != nil else { return }
            while !Task.isCancelled {
                await viewModel.refreshConversation(showErrors: false)
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    private var authenticationCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(viewModel.isCreatingAccount ? "Create your account" : "Welcome back")
                .font(.title3.weight(.semibold))
            Text(viewModel.isCreatingAccount
                 ? "Create an AccountabiliBuddy account to send bets in Messages."
                 : "Sign in to send and manage bets without leaving Messages.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            TextField("Email", text: $viewModel.email)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)

            if viewModel.isCreatingAccount {
                TextField("Username", text: $viewModel.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
            }

            SecureField("Password", text: $viewModel.password)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)

            Button {
                Task { await viewModel.authenticate() }
            } label: {
                Text(viewModel.isCreatingAccount ? "Create account" : "Sign in")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.isBusy)

            Button(viewModel.isCreatingAccount ? "Already have an account? Sign in" : "New here? Create an account") {
                viewModel.isCreatingAccount.toggle()
                viewModel.errorMessage = nil
            }
            .font(.footnote)
            .frame(maxWidth: .infinity)
        }
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    private var accountCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(viewModel.currentUser?.username ?? "")
                        .font(.headline)
                    Text(viewModel.currentUser?.email ?? "")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Sign out") {
                    viewModel.signOut()
                }
                .font(.caption)
            }

            if let profile = viewModel.profile {
                VStack(alignment: .leading, spacing: 4) {
                    Text("SOL balance")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("\(profile.solBalance, specifier: "%.4f") SOL")
                        .font(.title3.weight(.semibold))
                    Text("SOL address")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(profile.wallet)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }

            Button("Refresh balance") {
                Task {
                    do {
                        try await viewModel.refreshProfile()
                    } catch {
                        viewModel.errorMessage = error.localizedDescription
                    }
                }
            }
            .buttonStyle(.bordered)
        }
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    private var conversationCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let invite = viewModel.pendingConversation {
                Text("Conversation invite")
                    .font(.headline)
                Text("@\(invite.ownerUsername) invited you to join this AccountabiliBuddy conversation.")
                    .font(.subheadline)
                Button {
                    Task { await viewModel.joinPendingConversation() }
                } label: {
                    Label("Join conversation", systemImage: "person.badge.plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(viewModel.isBusy)
            } else if let conversation = viewModel.conversation {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Conversation initialized")
                            .font(.headline)
                        Text("\(conversation.members.count) joined member\(conversation.members.count == 1 ? "" : "s")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button {
                        Task { await viewModel.refreshConversation() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                }
                Text(conversation.members.map { "@\($0)" }.joined(separator: ", "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button {
                    viewModel.resendConversationInvite { draft in
                        onSendDraft(draft)
                    }
                } label: {
                    Label("Resend invite card", systemImage: "paperplane")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(viewModel.isBusy)
            } else {
                Text("This conversation hasn’t been initialized")
                    .font(.headline)
                Text("Send an invite card so other people can join and become available for direct challenges.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button {
                    Task {
                        await viewModel.initializeConversation { draft in
                            onSendDraft(draft)
                        }
                    }
                } label: {
                    Label("Initialize + insert invite card", systemImage: "person.3.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(viewModel.isBusy)
            }

            if let cid = viewModel.conversation?.id ?? viewModel.pendingConversation?.id {
                Divider()
                HStack {
                    Text("id …\(cid.suffix(6))")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    Spacer()
                    Button(role: .destructive) {
                        viewModel.resetConversation()
                    } label: {
                        Text("Reset").font(.caption)
                    }
                    .buttonStyle(.borderless)
                    .disabled(viewModel.isBusy)
                }
            }
        }
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    private var composeCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Create bet message")
                .font(.headline)

            Picker("Type", selection: $viewModel.betType) {
                ForEach(MessageBetType.allCases) { type in
                    Text(type.rawValue).tag(type)
                }
            }
            .pickerStyle(.segmented)
            Picker("Bet with", selection: $viewModel.recipientUsername) {
                if viewModel.recipientCandidates.isEmpty {
                    Text("No one found yet").tag("")
                }
                ForEach(viewModel.recipientCandidates, id: \.self) { username in
                    Text("@\(username)").tag(username)
                }
            }
            .pickerStyle(.menu)
            .disabled(viewModel.recipientCandidates.isEmpty)

            Text(viewModel.recipientCandidates.isEmpty
                 ? "No one else has joined yet. Ask someone to open the invite card and join."
                 : "Choose a joined AccountabiliBuddy member from this conversation.")
                .font(.caption)
                .foregroundStyle(.secondary)

            if viewModel.betType == .DEV {
                sportsBoard
            } else {
                TextEditor(text: $viewModel.terms)
                    .frame(minHeight: 78)
                    .padding(6)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.secondary.opacity(0.35), lineWidth: 1)
                    )
            }

            TextField("Stake (SOL)", text: $viewModel.stake)
                .keyboardType(.decimalPad)
                .textFieldStyle(.roundedBorder)

            Button {
                Task {
                    await viewModel.createBetAndDraftMessage { draft in
                        onSendDraft(draft)
                    }
                }
            } label: {
                Label("Create + insert iMessage card", systemImage: "message.badge")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(
                viewModel.isBusy
                || viewModel.recipientCandidates.isEmpty
                || (viewModel.betType == .DEV && viewModel.selectedGame == nil)
            )
        }
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .task(id: viewModel.betType) {
            if viewModel.betType == .DEV {
                await viewModel.ensureScoreboardLoaded()
            }
        }
    }

    private var sportsBoard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Sports board")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                if viewModel.gamesLoading {
                    ProgressView()
                }
                Button {
                    Task { await viewModel.loadScoreboard() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .disabled(viewModel.gamesLoading)
            }

            Picker("Sport", selection: $viewModel.sport) {
                ForEach(MessageSportKind.allCases) { kind in
                    Text(kind.label).tag(kind)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: viewModel.sport) { _ in
                Task { await viewModel.handleSportChange() }
            }

            Text("Pick a game")
                .font(.caption)
                .foregroundStyle(.secondary)

            gameList

            if let game = viewModel.selectedGame {
                sidePicker(for: game)
            }
        }
    }

    @ViewBuilder
    private var gameList: some View {
        if viewModel.gamesLoading && viewModel.games.isEmpty {
            Text("Loading \(viewModel.sport.label) games…")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, 8)
        } else if let error = viewModel.gamesError {
            Text(error)
                .font(.caption)
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, 8)
        } else if viewModel.games.isEmpty {
            Text("No \(viewModel.sport.label) games open for betting right now.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, 8)
        } else {
            VStack(spacing: 6) {
                ForEach(viewModel.games) { game in
                    gameRow(game)
                }
            }
        }
    }

    private func gameRow(_ game: MessageScoreboardGame) -> some View {
        let selected = viewModel.selectedGame?.gameId == game.gameId
        return Button {
            viewModel.selectGame(game)
        } label: {
            HStack {
                Text("\(game.awayTeam) @ \(game.homeTeam)")
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Spacer()
                Text(game.kickoffLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
            .background(
                (selected ? Color.accentColor.opacity(0.18) : Color.secondary.opacity(0.08)),
                in: RoundedRectangle(cornerRadius: 8)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(selected ? Color.accentColor : Color.clear, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func sidePicker(for game: MessageScoreboardGame) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Back which side?")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                sideButton(label: "AWAY", team: game.awayTeam, isHome: false)
                sideButton(label: "HOME", team: game.homeTeam, isHome: true)
            }
        }
    }

    private func sideButton(label: String, team: String, isHome: Bool) -> some View {
        let selected = viewModel.backsHome == isHome
        return Button {
            viewModel.backsHome = isHome
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(team)
                    .font(.caption.weight(.bold))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
            .background(
                (selected ? Color.green.opacity(0.18) : Color.secondary.opacity(0.08)),
                in: RoundedRectangle(cornerRadius: 8)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(selected ? Color.green : Color.clear, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var selectedBetCard: some View {
        if let card = viewModel.selectedCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("iMessage bet")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("\(card.type.rawValue) · \(card.statusLabel)")
                            .font(.headline)
                    }
                    Spacer()
                    Text("#\(card.betId)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Text(card.terms)
                    .font(.subheadline)

                if card.type == .PERSONAL {
                    HStack(spacing: 8) {
                        participantRole(
                            label: "Challenger",
                            username: card.challenger,
                            color: .purple
                        )
                        participantRole(
                            label: "Recipient",
                            username: card.acceptor,
                            color: .green
                        )
                    }
                }

                HStack {
                    Text("\(card.stake.amount) \(card.stake.currency)")
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    Text(card.onChain.label)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.trailing)
                }

                HStack {
                    Button("Refresh") {
                        guard let id = viewModel.selectedBetId else { return }
                        Task { await viewModel.loadBetCard(id) }
                    }
                    .buttonStyle(.bordered)

                    Button("Accept") {
                        Task { await viewModel.acceptSelectedBet() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!card.actions.canAccept || viewModel.isBusy)
                }

            }
            .padding(12)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private func participantRole(label: String, username: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(color)
            Text("@\(username)")
                .font(.caption.weight(.semibold))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder
    private var feedbackStrip: some View {
        if let message = viewModel.errorMessage, !message.isEmpty {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else if let message = viewModel.infoMessage, !message.isEmpty {
            Label(message, systemImage: "checkmark.circle.fill")
                .font(.caption)
                .foregroundStyle(.green)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
