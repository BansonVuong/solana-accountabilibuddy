import Foundation

enum RelayerClientError: LocalizedError {
    case invalidBaseURL
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            return "Invalid relayer URL."
        case .invalidResponse:
            return "Unexpected response from relayer."
        case .server(let message):
            return message
        }
    }
}

final class RelayerClient {
    private var baseURL: URL
    private var authToken: String

    init(baseURL: URL, authToken: String) {
        self.baseURL = baseURL
        self.authToken = authToken
    }

    func update(baseURL: URL, authToken: String) {
        self.baseURL = baseURL
        self.authToken = authToken
    }

    func login(email: String, password: String) async throws -> MessageAuthResponse {
        struct LoginBody: Codable {
            let email: String
            let password: String
        }
        return try await requestJSON(
            method: "POST",
            path: "/auth/login",
            body: LoginBody(email: email, password: password),
            responseType: MessageAuthResponse.self
        )
    }

    func signup(email: String, username: String, password: String) async throws -> MessageAuthResponse {
        struct SignupBody: Codable {
            let email: String
            let username: String
            let password: String
        }
        return try await requestJSON(
            method: "POST",
            path: "/auth/signup",
            body: SignupBody(email: email, username: username, password: password),
            responseType: MessageAuthResponse.self
        )
    }

    func currentUser() async throws -> MessageAuthUser {
        let response: MessageCurrentUserResponse = try await requestJSON(
            method: "GET",
            path: "/auth/me",
            body: Optional<String>.none,
            responseType: MessageCurrentUserResponse.self
        )
        return response.user
    }

    func fetchProfile() async throws -> MessageProfile {
        try await requestJSON(
            method: "GET",
            path: "/profile",
            body: Optional<String>.none,
            responseType: MessageProfile.self
        )
    }

    func createBet(_ request: MessageCreateBetRequest) async throws -> MessageCreateBetResponse {
        try await requestJSON(
            method: "POST",
            path: "/bets",
            body: request,
            responseType: MessageCreateBetResponse.self
        )
    }

    func fetchCard(betId: String) async throws -> MessageBetCard {
        let encoded = betId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? betId
        let envelope: MessageBetCardEnvelope = try await requestJSON(
            method: "GET",
            path: "/imessage/bets/\(encoded)",
            body: Optional<String>.none,
            responseType: MessageBetCardEnvelope.self
        )
        return envelope.card
    }

    func deepLink(for betId: String) async throws -> URL {
        let encoded = betId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? betId
        let response: MessageDeepLinkResponse = try await requestJSON(
            method: "GET",
            path: "/imessage/deeplink?betId=\(encoded)",
            body: Optional<String>.none,
            responseType: MessageDeepLinkResponse.self
        )
        guard let raw = response.url, let url = URL(string: raw) else {
            throw RelayerClientError.invalidResponse
        }
        return url
    }

    func acceptBet(betId: String) async throws {
        struct AcceptBody: Codable { let betId: String }
        struct EmptyResponse: Codable {}
        _ = try await requestJSON(
            method: "POST",
            path: "/bets/accept",
            body: AcceptBody(betId: betId),
            responseType: EmptyResponse.self
        )
    }

    func voteBet(betId: String, choice: MessageBetVoteChoice) async throws {
        struct VoteBody: Codable {
            let betId: String
            let votedFor: MessageBetVoteChoice
        }
        struct EmptyResponse: Codable {}
        _ = try await requestJSON(
            method: "POST",
            path: "/bets/vote",
            body: VoteBody(betId: betId, votedFor: choice),
            responseType: EmptyResponse.self
        )
    }

    private func requestJSON<Body: Encodable, Response: Decodable>(
        method: String,
        path: String,
        body: Body?,
        responseType: Response.Type
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw RelayerClientError.invalidBaseURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !authToken.isEmpty {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw RelayerClientError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            if let decoded = try? JSONDecoder().decode(MessageErrorResponse.self, from: data) {
                throw RelayerClientError.server(decoded.error)
            }
            throw RelayerClientError.server("Relayer request failed (\(http.statusCode)).")
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}
