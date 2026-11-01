import { useRoute } from './lib/router';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Library } from './pages/Library';
import { DrillDetail } from './pages/DrillDetail';
import { Planner } from './pages/Planner';
import { SessionExec } from './pages/SessionExec';
import { ParentView } from './pages/ParentView';
import { Progress } from './pages/Progress';
import { Admin } from './pages/Admin';
import { Compete } from './pages/Compete';
import { MatchPage } from './pages/MatchPage';
import { MatchSetup } from './pages/MatchSetup';
import { TournamentDetail } from './pages/TournamentDetail';

export function App() {
  const { name, param } = useRoute();
  let page;
  switch (name) {
    case 'library':
      page = <Library />;
      break;
    case 'drill':
      page = <DrillDetail id={param} key={param} />;
      break;
    case 'planner':
      page = <Planner planId={param} />;
      break;
    case 'session':
      page = <SessionExec sessionId={param} key={param} />;
      break;
    case 'parent':
      page = <ParentView />;
      break;
    case 'progress':
      page = <Progress />;
      break;
    case 'admin':
      page = <Admin />;
      break;
    case 'matches':
    case 'tournaments':
      page = <Compete tab={name} />;
      break;
    case 'newmatch':
      page = <MatchSetup tournamentId={param} key={param} />;
      break;
    case 'match':
      page = <MatchPage id={param} key={param} />;
      break;
    case 'tournament':
      page = <TournamentDetail id={param} key={param} />;
      break;
    default:
      page = <Dashboard />;
  }
  return <Layout route={name}>{page}</Layout>;
}
