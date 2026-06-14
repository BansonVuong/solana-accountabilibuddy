import Foundation
import Combine

struct BetDraftMessage {
    let url: URL
    let title: String
    let subtitle: String
    let wallet: String?
    let solBalance: Double?
}

@MainActor
final class BetMessageViewModel: ObservableObject {
    @Published var email: String = ""
    @Published var username: String = ""
    @Published var password: String = ""
    @Published var isCreatingAccount: Bool = false
    @Published var currentUser: MessageAuthUser?
    @Published var profile: MessageProfile?

    @Published var betType: MessageBetType = .PERSONAL
    @Published var terms: String = ""
    @Published var stake: String = ""
    @Published var recipientUsername: String = ""
    @Published var recipientCandidates: [String] = []
    @Published var conversation: MessageConversation?
    @Published var pendingConversation: MessageConversation?

    @Published var sport: MessageSportKind = .nba
    @Published var backsHome: Bool = true

    @Published var games: [MessageScoreboardGame] = []
    @Published var gamesLoading: Bool = false
    @Published var gamesError: String?
    @Published var selectedGame: MessageScoreboardGame?
    private var scoreboardLoadedForSport: MessageSportKind?

    @Published var selectedBetId: String?
    @Published var selectedCard: MessageBetCard?
    @Published var isBusy: Bool = false
    @Published var infoMessage: String?
    @Published var errorMessage: String?
    @Published var debugInfo: String = "no card opened yet"

    var isSignedIn: Bool { currentUser != nil }

    private let defaults = UserDefaults.standard
    private let authTokenKey = "imessage.authToken"
    private let conversationKeyPrefix = "imessage.conversation."
    private let productionURL = URL(string: "https://66.42.115.38.nip.io")!
    private var authToken: String
    private var hasBootstrapped = false
    private var conversationFingerprint: String?
    private var localParticipantId: String?
    private var conversationParticipantIds: [String] = []
    private var pendingConversationId: String?
    private let client: RelayerClient

    init() {
        let savedToken = defaults.string(forKey: authTokenKey) ?? ""

        self.authToken = savedToken
        self.client = RelayerClient(
            baseURL: productionURL,
            authToken: savedToken
        )
    }

    func bootstrap() async {
        guard !hasBootstrapped else { return }
        guard !authToken.isEmpty else {
            hasBootstrapped = true
            return
        }

        do {
            isBusy = true
            currentUser = try await client.currentUser()
            try await refreshProfile()
            await refreshConversationState()
        } catch {
            signOut(showMessage: false)
        }
        isBusy = false
        hasBootstrapped = true
    }

    func authenticate() async {
        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedEmail.isEmpty, !password.isEmpty else {
            errorMessage = "Email and password are required."
            return
        }
        if isCreatingAccount && normalizedUsername.isEmpty {
            errorMessage = "Username is required."
            return
        }

        do {
            isBusy = true
            errorMessage = nil
            let response: MessageAuthResponse
            if isCreatingAccount {
                response = try await client.signup(email: normalizedEmail, username: normalizedUsername, password: password)
            } else {
                response = try await client.login(email: normalizedEmail, password: password)
            }
            authToken = response.token
            currentUser = response.user
            client.update(baseURL: productionURL, authToken: response.token)
            defaults.set(response.token, forKey: authTokenKey)
            password = ""
            try await refreshProfile()
            await linkCurrentMessagesIdentity()
            await refreshConversationState()
            await synchronizeInitializedConversation()
            // If they opened the app by tapping an invite card before signing in, finish the
            // join now instead of leaving them on a manual "Join conversation" button.
            if conversation?.joined != true {
                await joinPendingConversation()
            }
            infoMessage = isCreatingAccount ? "Account created." : "Signed in."
        } catch {
            errorMessage = error.localizedDescription
        }
        isBusy = false
    }

    func refreshProfile() async throws {
        profile = try await client.fetchProfile()
    }

    func signOut(showMessage: Bool = true) {
        authToken = ""
        currentUser = nil
        profile = nil
        selectedBetId = nil
        selectedCard = nil
        recipientUsername = ""
        recipientCandidates = []
        conversation = nil
        pendingConversation = nil
        client.update(baseURL: productionURL, authToken: "")
        defaults.removeObject(forKey: authTokenKey)
        if showMessage {
            infoMessage = "Signed out."
        }
    }

    func setDebug(_ text: String) {
        debugInfo = text
    }

    func openFromIncomingURL(_ url: URL?) async {
        if let conversationId = Self.conversationId(from: url) {
            debugInfo = "got convId …\(conversationId.suffix(6))"
            pendingConversationId = conversationId
            await bootstrap()
            guard isSignedIn else { debugInfo = "convId …\(conversationId.suffix(6)) but NOT signed in"; return }
            // Tapping the invite card IS the join action. If we're already a joined member
            // of this exact conversation just refresh it; otherwise join automatically so
            // detection never depends on the recipient also finding a separate "Join" button.
            if conversation?.id == conversationId, conversation?.joined == true {
                await refreshConversation(showErrors: false)
                return
            }
            let savedConversationId = conversationFingerprint.flatMap {
                defaults.string(forKey: conversationKeyPrefix + $0)
            }
            let switched = (conversation?.id ?? savedConversationId) != nil
            await joinConversation(conversationId, switchedFromAnotherConversation: switched)
            return
        }
        guard let id = Self.betId(from: url) else { return }
        await bootstrap()
        await loadBetCard(id)
    }

    func updateConversationParticipants(local: String, remote: [String]) async {
        localParticipantId = local.lowercased()
        conversationParticipantIds = ([local] + remote)
            .map { $0.lowercased() }
            .sorted()
        conversationFingerprint = conversationParticipantIds.joined(separator: ".")
        await bootstrap()
        guard isSignedIn else { return }
        await linkCurrentMessagesIdentity()
        await refreshConversationState()
        await synchronizeInitializedConversation()
    }

    func initializeConversation(sendDraft: (BetDraftMessage) -> Void) async {
        do {
            try requireSignedIn()
            guard conversationFingerprint != nil else {
                throw RelayerClientError.server("Open AccountabiliBuddy from an active Messages conversation.")
            }
            isBusy = true
            errorMessage = nil
            let created = try await client.createConversation(participantIds: conversationParticipantIds)
            guard let inviteURL = URL(string: created.inviteUrl) else {
                throw RelayerClientError.invalidResponse
            }
            conversation = created.conversation
            pendingConversation = nil
            pendingConversationId = nil
            persistConversationId(created.conversation.id)
            refreshRecipientCandidates()
            sendDraft(BetDraftMessage(
                url: inviteURL,
                title: "Join AccountabiliBuddy conversation",
                subtitle: "@\(created.conversation.ownerUsername) initialized this conversation. Open to join.",
                wallet: nil,
                solBalance: nil
            ))
            infoMessage = "Invite card ready to send."
        } catch {
            errorMessage = error.localizedDescription
        }
        isBusy = false
    }

    func joinPendingConversation() async {
        guard let pendingConversationId else { return }
        await joinConversation(pendingConversationId, switchedFromAnotherConversation: false)
    }

    private func joinConversation(_ id: String, switchedFromAnotherConversation: Bool) async {
        do {
            try requireSignedIn()
            isBusy = true
            errorMessage = nil
            let joined = try await client.joinConversation(id: id)
            conversation = joined
            pendingConversation = nil
            self.pendingConversationId = nil
            persistConversationId(joined.id)
            refreshRecipientCandidates()
            infoMessage = switchedFromAnotherConversation
                ? "Switched to and joined this AccountabiliBuddy conversation."
                : "Joined this AccountabiliBuddy conversation."
        } catch {
            errorMessage = error.localizedDescription
        }
        isBusy = false
    }

    func resendConversationInvite(sendDraft: (BetDraftMessage) -> Void) {
        guard let conversation else {
            errorMessage = "Initialize or join this conversation first."
            return
        }
        guard let inviteURL = Self.messagePayloadURL(
            queryItems: [URLQueryItem(name: "conversationId", value: conversation.id)]
        ) else {
            errorMessage = RelayerClientError.invalidResponse.localizedDescription
            return
        }
        sendDraft(BetDraftMessage(
            url: inviteURL,
            title: "Join AccountabiliBuddy conversation",
            subtitle: "@\(conversation.ownerUsername) initialized this conversation. Open to join.",
            wallet: nil,
            solBalance: nil
        ))
        infoMessage = "Invite card ready to send again."
    }

    /// Clears the locally cached conversation for this thread so a stale account can start
    /// fresh. Does not delete the server conversation — it just stops auto-reloading the old
    /// one, so the next Initialize (or invite-card tap) rebinds this device cleanly.
    func resetConversation() {
        if let fingerprint = conversationFingerprint {
            defaults.removeObject(forKey: conversationKeyPrefix + fingerprint)
        }
        conversation = nil
        pendingConversation = nil
        pendingConversationId = nil
        recipientCandidates = []
        recipientUsername = ""
        infoMessage = "Cleared cached conversation. Initialize on one device, then tap that fresh card on the other."
    }

    func refreshConversation(showErrors: Bool = true) async {
        guard let id = conversation?.id else { return }
        do {
            conversation = try await client.fetchConversation(id: id)
            refreshRecipientCandidates()
        } catch {
            if showErrors {
                errorMessage = error.localizedDescription
            }
        }
    }

    func loadBetCard(_ betId: String) async {
        do {
            try requireSignedIn()
            isBusy = true
            errorMessage = nil
            selectedBetId = betId
            selectedCard = try await client.fetchCard(betId: betId)
            infoMessage = "Loaded bet \(betId)."
        } catch {
            errorMessage = error.localizedDescription
        }
        isBusy = false
    }

    /// Loads the scoreboard for the current sport once; safe to call repeatedly.
    func ensureScoreboardLoaded() async {
        guard scoreboardLoadedForSport != sport || (games.isEmpty && gamesError == nil) else { return }
        await loadScoreboard()
    }

    /// Called after the sport picker mutates `sport`; resets the selection and reloads.
    func handleSportChange() async {
        selectedGame = nil
        backsHome = true
        await loadScoreboard()
    }

    func loadScoreboard() async {
        do {
            gamesLoading = true
            gamesError = nil
            let fetched = try await client.fetchScoreboard(sport: sport)
            games = fetched
            if let current = selectedGame, !fetched.contains(where: { $0.gameId == current.gameId }) {
                selectedGame = nil
            }
            scoreboardLoadedForSport = sport
        } catch {
            games = []
            selectedGame = nil
            gamesError = error.localizedDescription
        }
        gamesLoading = false
    }

    func selectGame(_ game: MessageScoreboardGame) {
        selectedGame = game
        backsHome = true
        errorMessage = nil
        infoMessage = nil
    }

    func createBetAndDraftMessage(sendDraft: (BetDraftMessage) -> Void) async {
        do {
            try requireSignedIn()
            let request = try buildCreateBetRequest()
            isBusy = true
            errorMessage = nil

            let created = try await client.createBet(request)
            let link = try await client.deepLink(for: created.bet.id)
            selectedBetId = created.bet.id
            selectedCard = try await client.fetchCard(betId: created.bet.id)
            try? await refreshProfile()

            let draft = BetDraftMessage(
                url: link,
                title: "\(betType.rawValue) bet · \(request.stake) SOL",
                subtitle: request.terms,
                wallet: profile?.wallet,
                solBalance: profile?.solBalance
            )
            sendDraft(draft)
            infoMessage = "Bet created and ready to send in iMessage."
            clearComposeForm()
        } catch {
            errorMessage = error.localizedDescription
        }
        isBusy = false
    }

    func acceptSelectedBet() async {
        guard let betId = selectedBetId else { return }
        do {
            try requireSignedIn()
            isBusy = true
            errorMessage = nil
            try await client.acceptBet(betId: betId)
            selectedCard = try await client.fetchCard(betId: betId)
            try? await refreshProfile()
            infoMessage = "Bet accepted."
        } catch {
            errorMessage = error.localizedDescription
        }
        isBusy = false
    }

    func voteSelectedBet(_ choice: MessageBetVoteChoice) async {
        guard let betId = selectedBetId else { return }
        do {
            try requireSignedIn()
            isBusy = true
            errorMessage = nil
            try await client.voteBet(betId: betId, choice: choice)
            selectedCard = try await client.fetchCard(betId: betId)
            infoMessage = "Vote submitted."
        } catch {
            errorMessage = error.localizedDescription
        }
        isBusy = false
    }

    private func requireSignedIn() throws {
        if authToken.isEmpty || currentUser == nil {
            throw RelayerClientError.server("Sign in to continue.")
        }
    }

    private func refreshRecipientCandidates() {
        guard let currentUser, let conversation, conversation.joined else {
            recipientCandidates = []
            recipientUsername = ""
            return
        }
        let candidates = conversation.members.filter {
            $0.caseInsensitiveCompare(currentUser.username) != .orderedSame
        }.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
        recipientCandidates = candidates
        recipientUsername = candidates.first(where: {
            $0.caseInsensitiveCompare(recipientUsername) == .orderedSame
        }) ?? candidates.first ?? ""
    }

    private func buildCreateBetRequest() throws -> MessageCreateBetRequest {
        guard let conversation, conversation.joined else {
            throw RelayerClientError.server("Initialize or join this conversation first.")
        }
        let trimmedStake = stake.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let numericStake = Double(trimmedStake), numericStake > 0 else {
            throw RelayerClientError.server("Stake must be a positive SOL amount.")
        }
        let selectedRecipient = recipientUsername.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let normalizedAcceptor = recipientCandidates.first(where: {
            $0.caseInsensitiveCompare(selectedRecipient) == .orderedSame
        }) else {
            throw RelayerClientError.server("Choose a joined member from this conversation.")
        }

        let sportsMode = betType == .DEV
        let selectedGame = sportsMode ? self.selectedGame : nil

        let normalizedTerms: String
        if sportsMode {
            guard let game = selectedGame else {
                throw RelayerClientError.server("Pick a game from the board first.")
            }
            let backedTeam = backsHome ? game.homeTeam : game.awayTeam
            let challenger = currentUser?.username ?? "challenger"
            normalizedTerms = "\(sport.label): \(game.awayTeam) @ \(game.homeTeam) — \(challenger) backs \(backedTeam)."
        } else {
            let trimmedTerms = terms.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmedTerms.count < 8 {
                throw RelayerClientError.server("Terms must be at least 8 characters.")
            }
            normalizedTerms = trimmedTerms
        }

        return MessageCreateBetRequest(
            source: "imessage",
            imessageConversationId: conversation.id,
            type: betType,
            acceptor: normalizedAcceptor,
            terms: normalizedTerms,
            stake: trimmedStake,
            currency: "SOL",
            sport: sportsMode ? sport.rawValue : nil,
            gameId: selectedGame?.gameId,
            backsHome: sportsMode ? backsHome : nil,
            homeTeam: selectedGame?.homeTeam,
            awayTeam: selectedGame?.awayTeam
        )
    }

    private func clearComposeForm() {
        terms = ""
        stake = ""
        recipientUsername = recipientCandidates.first ?? ""
        backsHome = true
        selectedGame = nil
    }

    private static func betId(from url: URL?) -> String? {
        guard let url else { return nil }
        if let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
           let fromQuery = queryItems.first(where: { $0.name == "betId" })?.value,
           !fromQuery.isEmpty {
            return fromQuery
        }

        if url.scheme == "accountabilibuddy", url.host == "bet" {
            let id = url.pathComponents.filter { $0 != "/" }.first
            if let id, !id.isEmpty { return id }
        }

        let parts = url.pathComponents.filter { $0 != "/" }
        if let marker = parts.firstIndex(where: { $0 == "bet" || $0 == "bets" }),
           parts.indices.contains(marker + 1) {
            return parts[marker + 1]
        }
        return nil
    }

    private static func conversationId(from url: URL?) -> String? {
        guard let url else { return nil }
        if let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
           let fromQuery = queryItems.first(where: { $0.name == "conversationId" })?.value,
           !fromQuery.isEmpty {
            return fromQuery
        }
        if url.scheme == "accountabilibuddy", url.host == "conversation" {
            return url.pathComponents.filter { $0 != "/" }.first
        }
        let parts = url.pathComponents.filter { $0 != "/" }
        if let marker = parts.firstIndex(where: { $0 == "conversation" || $0 == "conversations" }),
           parts.indices.contains(marker + 1) {
            return parts[marker + 1]
        }
        return nil
    }

    private static func messagePayloadURL(queryItems: [URLQueryItem]) -> URL? {
        var components = URLComponents()
        components.queryItems = queryItems
        return components.url
    }

    private func refreshConversationState() async {
        if let requestedConversationId = pendingConversationId {
            await loadPendingConversation(requestedConversationId)
            if pendingConversation?.id == requestedConversationId || conversation?.id == requestedConversationId {
                refreshRecipientCandidates()
                return
            }
        }
        guard let fingerprint = conversationFingerprint,
              let savedId = defaults.string(forKey: conversationKeyPrefix + fingerprint) else {
            conversation = nil
            refreshRecipientCandidates()
            return
        }
        do {
            let savedConversation = try await client.fetchConversation(id: savedId)
            if savedConversation.joined {
                conversation = savedConversation
            } else {
                defaults.removeObject(forKey: conversationKeyPrefix + fingerprint)
                conversation = nil
            }
        } catch {
            conversation = nil
        }
        refreshRecipientCandidates()
    }

    private func loadPendingConversation(_ id: String) async {
        do {
            let invite = try await client.fetchConversation(id: id)
            if invite.joined {
                conversation = invite
                pendingConversation = nil
                pendingConversationId = nil
                persistConversationId(invite.id)
                refreshRecipientCandidates()
            } else {
                pendingConversation = invite
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func persistConversationId(_ id: String) {
        guard let conversationFingerprint else { return }
        defaults.set(id, forKey: conversationKeyPrefix + conversationFingerprint)
    }

    private func linkCurrentMessagesIdentity() async {
        guard let localParticipantId, !localParticipantId.isEmpty else { return }
        do {
            try await client.linkParticipant(localParticipantId)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func synchronizeInitializedConversation() async {
        guard !conversationParticipantIds.isEmpty else { return }

        // The participant fingerprint is only stable on *this* device. Apple's
        // participant UUIDs are not correlatable across devices, so our fingerprint can
        // never match the other participants'. Once we've joined a conversation (always
        // via an invite card — the one reliable cross-device link), never replace it with
        // a fingerprint-derived one, or we'd silently drop back to a solo conversation and
        // "lose" everyone who already joined.
        if let conversation, conversation.joined { return }

        let savedConversationId = conversationFingerprint.flatMap {
            defaults.string(forKey: conversationKeyPrefix + $0)
        }
        guard conversation != nil || savedConversationId != nil else { return }

        // Prefer reloading the exact conversation this device already knows about over
        // minting a duplicate keyed by our local fingerprint.
        if let savedConversationId,
           let reloaded = try? await client.fetchConversation(id: savedConversationId),
           reloaded.joined {
            conversation = reloaded
            pendingConversation = nil
            pendingConversationId = nil
            refreshRecipientCandidates()
            return
        }

        do {
            let shared = try await client.createConversation(participantIds: conversationParticipantIds).conversation
            conversation = shared
            pendingConversation = nil
            pendingConversationId = nil
            persistConversationId(shared.id)
            refreshRecipientCandidates()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
