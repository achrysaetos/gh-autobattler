import { UnitKind } from '../../sim/api.ts';
import { UnitIcon } from './icons.tsx';
import { Modal } from './Modal.tsx';

export function ArticlesOfWar({ onClose }: { onClose(): void }) {
  return (
    <Modal title="Articles of War" subtitle="How public GitHub work becomes soldiers, and how they fight without you." onClose={onClose}>
      <h3>
        <span className="num">I</span> What we read, and what we refuse to claim
      </h3>
      <p>
        Pushfront reads only your <strong>public</strong> activity. Signing in proves who you are once; the token is discarded and you grant no scopes. Private repositories, restricted
        counts, and lines changed are ignored. Lines changed are easy to inflate and say nothing about value.
      </p>
      <div className="callout">We measure public activity, consistency, and peer acceptance. We never claim to measure engineering quality.</div>

      <h3>
        <span className="num">II</span> The tour of duty
      </h3>
      <p>
        Every soldier serves a <strong>28-day tour</strong>. Your army is recomputed from the last 28 UTC days, today included. Each day raises:
      </p>
      <table className="rules-table">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Earned by</th>
            <th>Per day</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <span className="troop-name">
                <UnitIcon kind={UnitKind.Infantry} />
                Infantry
              </span>
            </td>
            <td>Commits that day</td>
            <td>1 for 1 commit, 2 for 2 to 3, 3 for 4 to 7, 4 for 8 or more</td>
          </tr>
          <tr>
            <td>
              <span className="troop-name">
                <UnitIcon kind={UnitKind.Archer} />
                Archers
              </span>
            </td>
            <td>Reviews of other people's pull requests</td>
            <td>1 each, at most 3</td>
          </tr>
          <tr>
            <td>
              <span className="troop-name">
                <UnitIcon kind={UnitKind.Cavalry} />
                Cavalry
              </span>
            </td>
            <td>Your pull requests merged by someone else into a repo you do not own</td>
            <td>1 each, at most 3</td>
          </tr>
        </tbody>
      </table>
      <p>
        Daily caps are the anti-spam rule: a thousand commits on one day count the same as eight. The most anyone can field is <strong>280 soldiers</strong>, and only through daily,
        varied, peer-accepted work.
      </p>
      <p>
        <strong>Rank</strong> rewards consistency. Every 7 active days earn a rank, up to rank 4 at 28 days. Each rank adds <strong>8% health and damage</strong> to every one of your
        soldiers.
      </p>

      <h3>
        <span className="num">III</span> Factions
      </h3>
      <p>
        Factions form at the start of each round. With N players there are about √N factions, at least 2 and at most 8. Players are dealt out so every faction has a similar number of
        soldiers, and a faction is named for its members' most common language. If you enlist mid-round, you join the faction with the fewest soldiers. Underdogs get the reinforcements.
      </p>

      <h3>
        <span className="num">IV</span> The battlefield
      </h3>
      <p>
        The map is a disc with one identical sector per faction, so nobody gets better ground. At most <strong>2400 soldiers</strong> fight at once; if the armies are bigger, everyone is
        scaled down by the same fraction, keeping at least 1 of any kind they have.
      </p>
      <p>
        Each faction has a <strong>camp</strong> on the outer ring where its soldiers respawn; camps cannot be taken. There are two <strong>strongholds</strong> per faction and one{' '}
        <strong>Citadel</strong> at the center, each starting with a neutral garrison. <strong>Forest</strong> slows movement by 40% and halves incoming arrow damage.{' '}
        <strong>Water</strong> and <strong>rock</strong> cannot be crossed.
      </p>
      <p>
        The ground is a grid of hexes. A hex turns to your faction when only your soldiers are near it. Hexes next to a held objective drift back to its owner when nobody contests them.
      </p>

      <h3>
        <span className="num">V</span> Combat
      </h3>
      <p>Infantry beats cavalry, cavalry beats archers, archers beat infantry. Each favored matchup deals 1.5× damage.</p>
      <table className="rules-table">
        <thead>
          <tr>
            <th>Unit</th>
            <th>HP</th>
            <th>Damage</th>
            <th>Range</th>
            <th>Speed</th>
            <th>Cooldown</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Infantry</td>
            <td className="mono">120</td>
            <td className="mono">12</td>
            <td>Melee</td>
            <td>Slow</td>
            <td className="mono">1.0 s</td>
          </tr>
          <tr>
            <td>Archer</td>
            <td className="mono">70</td>
            <td className="mono">9</td>
            <td>Long</td>
            <td>Medium</td>
            <td className="mono">1.4 s</td>
          </tr>
          <tr>
            <td>Cavalry</td>
            <td className="mono">100</td>
            <td className="mono">15</td>
            <td>Melee</td>
            <td>Fast</td>
            <td className="mono">1.2 s</td>
          </tr>
        </tbody>
      </table>
      <p>
        A fallen soldier returns at its camp <strong>20 seconds</strong> later, as long as you still have that soldier on your tour. When your tour shrinks, the surplus is not replaced
        when it falls.
      </p>

      <h3>
        <span className="num">VI</span> Nobody steers
      </h3>
      <p>
        Every 3 seconds each faction's war council gives every warband an objective, weighing points, distance, and the strength already near it. Warbands spread across fronts. A warband
        facing more than 1.6× its strength falls back to the nearest friendly objective. Cavalry prefers lightly held objectives, and archers stay behind friendly infantry.
      </p>

      <h3>
        <span className="num">VII</span> Victory
      </h3>
      <table className="rules-table">
        <thead>
          <tr>
            <th>Every second, a faction scores</th>
            <th>Points</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Per 10 hexes held</td>
            <td className="mono">1</td>
          </tr>
          <tr>
            <td>Per stronghold</td>
            <td className="mono">5</td>
          </tr>
          <tr>
            <td>The Citadel</td>
            <td className="mono">15</td>
          </tr>
        </tbody>
      </table>
      <p>
        A round runs <strong>7 days</strong>, Monday 00:00 UTC to the next Monday. The most points wins. A faction that holds every stronghold and the Citadel for{' '}
        <strong>6 continuous hours</strong> wins at once. After each round a 1 hour intermission shows the results, then new factions form on a new map. Lifetime records and medals carry
        over.
      </p>
    </Modal>
  );
}
