import { useAuth } from '../hooks/useAuth.jsx';
import { useRoom } from '../hooks/useRoom.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import ScoreBoard from '../components/ScoreBoard.jsx';
import Wheel from '../components/Wheel.jsx';
import TurnPanel from '../components/TurnPanel.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import ResultToast from '../components/ResultToast.jsx';

function PartieScreen() {
  const { user } = useAuth();
  const { room, sendAnswer, sendVote, sendChat } = useRoom();
  const { t } = useI18n();
  const myId = String(user.id);

  return (
    <div className="screen partie-screen">
      <ScoreBoard players={room.players} activePlayerId={room.currentTurn?.activePlayerId} />

      <p className="niveau-indicator">{t(`niveau.label.${room.niveauMax}`)}</p>

      <ResultToast result={room.lastResult} players={room.players} />

      <Wheel type={room.currentTurn?.type} turnNumber={room.currentTurn?.turnNumber} />

      <TurnPanel
        turn={room.currentTurn}
        players={room.players}
        myId={myId}
        onSubmitAnswer={sendAnswer}
        onVote={sendVote}
      />

      <ChatPanel messages={room.messages} myId={myId} onSend={sendChat} />
    </div>
  );
}

export default PartieScreen;
