export class VictoryContextBuilder {
  static build(battle) {
    if (!battle?.outcome?.resolved) return null;
    return {
      ...battle.outcome,
      canContinue: Boolean(game.user.isGM),
      scoreRows: ["elimination", "decision", "draw", "escapeDenied"].includes(battle.outcome.reason) ? Object.entries(battle.outcome.scores ?? {}).map(([sideId, score]) => ({
        sideId,
        name: battle.setup?.sides?.[sideId]?.name ?? sideId,
        score: Number(score ?? 0).toFixed(1),
        winner: battle.outcome.winnerSideId === sideId
      })) : []
    };
  }
}
