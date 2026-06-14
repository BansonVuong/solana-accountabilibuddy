import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("BAAM")
                .font(.title2)
                .fontWeight(.semibold)
            Text("Use the Messages extension target to compose, send, and resolve bet cards.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(24)
    }
}
