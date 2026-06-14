import SwiftUI

struct BetMessageRootView: View {
    @ObservedObject var viewModel: BetMessageViewModel
    let onSendDraft: (BetDraftMessage) -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if viewModel.isSignedIn {
                    accountCard
                    composeCard
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
                    if viewModel.isMessagesIdentityLinked {
                        Text("@\(viewModel.currentUser?.username ?? "") linked to this Messages identity")
                            .font(.caption2)
                            .foregroundStyle(.green)
                    }
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
            if viewModel.recipientCandidates.isEmpty {
                TextField("Target username (optional)", text: $viewModel.recipientUsername)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                Text("Participants appear here after they open AccountabiliBuddy in this conversation and sign in once.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                Picker("Target recipient", selection: $viewModel.recipientUsername) {
                    Text("Any member").tag("")
                    ForEach(viewModel.recipientCandidates, id: \.self) { username in
                        Text("@\(username)").tag(username)
                    }
                }
                .pickerStyle(.menu)
            }

            Text("Known participants are shown by AccountabiliBuddy username. Apple does not expose phone numbers or iCloud emails to Messages extensions.")
                .font(.caption)
                .foregroundStyle(.secondary)

            if viewModel.betType == .DEV {
                TextField("Sport (nba | nfl | soccer)", text: $viewModel.sport)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                TextField("ESPN game ID", text: $viewModel.gameId)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                TextField("Home team (optional)", text: $viewModel.homeTeam)
                    .textFieldStyle(.roundedBorder)
                TextField("Away team (optional)", text: $viewModel.awayTeam)
                    .textFieldStyle(.roundedBorder)
                Toggle("Challenger backs home", isOn: $viewModel.backsHome)
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
            .disabled(viewModel.isBusy)
        }
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
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
