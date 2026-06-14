import Foundation
import Combine

struct BetDraftMessage {
    let url: URL
    let title: String
    let subtitle: String
}

@MainActor
final class BetMessageViewModel: ObservableObject {
    @Published var email: String = ""
    @Published var username: String = ""
    @Published var password: String = ""
    @Published var isCreatingAccount: Bool = false
    @Published var currentUser: MessageAuthUser?
    @Published var groups: [MessageGroup] = []
    @Published var groupId: String

    @Published var betType: MessageBetType = .PERSONAL
    @Published var acceptor: String = ""
    @Published var terms: String = ""
    @Published var stake: String = ""
    @Published var witnesses: Int = 2
    @Published var minBettors: Int = 2

    @Published var useSportsValidation: Bool = false
    @Published var sport: String = "nba"
    @Published var gameId: String = ""
    @Published var backsHome: Bool = true
    @Published var homeTeam: String = ""
    @Published var awayTeam: String = ""

    @Published var selectedBetId: String?
    @Published var selectedCard: MessageBetCard?
    @Published var isBusy: Bool = false
    @Published var infoMessage: String?
    @Published var errorMessage: String?

    var isSignedIn: Bool { currentUser != nil }

    private let defaults = UserDefaults.standard
    private let authTokenKey = "imessage.authToken"
    private let groupIDKey = "imessage.defaultGroupID"
    private let productionURL = URL(string: "https://66.42.115.38.nip.io")!
    private var authToken: String
    private var hasBootstrapped = false
    private let client: RelayerClient

    init() {
        let savedToken = defaults.string(forKey: authTokenKey) ?? ""
        let savedGroup = defaults.string(forKey: groupIDKey) ?? ""

        self.authToken = savedToken
        self.groupId = savedGroup
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
            try await refreshGroups()
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
            try await refreshGroups()
            infoMessage = isCreatingAccount ? "Account created." : "Signed in."
        } catch {
            errorMessage = error.localizedDescription
        }
        isBusy = false
    }

    func refreshGroups() async throws {
        groups = try await client.fetchGroups().sorted {
            ($0.updatedAt ?? 0) > ($1.updatedAt ?? 0)
        }
        if !groups.contains(where: { $0.id == groupId }) {
            groupId = groups.first?.id ?? ""
        }
        defaults.set(groupId, forKey: groupIDKey)
    }

    func selectGroup(_ id: String) {
        groupId = id
        defaults.set(id, forKey: groupIDKey)
    }

    func signOut(showMessage: Bool = true) {
        authToken = ""
        currentUser = nil
        groups = []
        groupId = ""
        selectedBetId = nil
        selectedCard = nil
        client.update(baseURL: productionURL, authToken: "")
        defaults.removeObject(forKey: authTokenKey)
        defaults.removeObject(forKey: groupIDKey)
        if showMessage {
            infoMessage = "Signed out."
        }
    }

    func openFromIncomingURL(_ url: URL?) async {
        guard let id = Self.betId(from: url) else { return }
        await bootstrap()
        await loadBetCard(id)
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

            let draft = BetDraftMessage(
                url: link,
                title: "\(betType.rawValue) bet · \(request.stake) SOL",
                subtitle: request.terms
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

    private func buildCreateBetRequest() throws -> MessageCreateBetRequest {
        let trimmedGroupId = groupId.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedGroupId.isEmpty {
            throw RelayerClientError.server("Group ID is required.")
        }

        let trimmedStake = stake.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let numericStake = Double(trimmedStake), numericStake > 0 else {
            throw RelayerClientError.server("Stake must be a positive SOL amount.")
        }

        let normalizedAcceptor: String
        if betType == .DEV {
            let trimmed = acceptor.trimmingCharacters(in: .whitespacesAndNewlines)
            normalizedAcceptor = trimmed.isEmpty ? "anyone" : trimmed
        } else {
            let trimmed = acceptor.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                throw RelayerClientError.server("Acceptor username is required for PERSONAL bets.")
            }
            normalizedAcceptor = trimmed
        }

        let normalizedTerms: String
        if betType == .DEV && useSportsValidation {
            let trimmedGameID = gameId.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmedGameID.isEmpty {
                throw RelayerClientError.server("Sports game ID is required when sports validation is enabled.")
            }
            normalizedTerms = "Sports DEV bet for \(sport.uppercased()) game \(trimmedGameID)."
        } else {
            let trimmedTerms = terms.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmedTerms.count < 8 {
                throw RelayerClientError.server("Terms must be at least 8 characters.")
            }
            normalizedTerms = trimmedTerms
        }

        let sportsMode = betType == .DEV && useSportsValidation

        return MessageCreateBetRequest(
            groupId: trimmedGroupId,
            type: betType,
            acceptor: normalizedAcceptor,
            terms: normalizedTerms,
            stake: trimmedStake,
            currency: "SOL",
            witnesses: max(1, witnesses),
            minBettors: max(1, minBettors),
            sport: sportsMode ? sport.lowercased() : nil,
            gameId: sportsMode ? gameId.trimmingCharacters(in: .whitespacesAndNewlines) : nil,
            backsHome: sportsMode ? backsHome : nil,
            homeTeam: sportsMode ? optionalTrimmed(homeTeam) : nil,
            awayTeam: sportsMode ? optionalTrimmed(awayTeam) : nil
        )
    }

    private func clearComposeForm() {
        acceptor = ""
        terms = ""
        stake = ""
        useSportsValidation = false
        sport = "nba"
        gameId = ""
        backsHome = true
        homeTeam = ""
        awayTeam = ""
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

    private func optionalTrimmed(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
