import { useAuth } from '../hooks/useAuth.jsx';
import { useRoom } from '../hooks/useRoom.jsx';
import ScoreBoard from '../components/ScoreBoard.jsx';
import Wheel from '../components/Wheel.jsx';
import TurnPanel from '../components/TurnPanel.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import ResultToast from '../components/ResultToast.jsx';

function PartieScreen() {
  const { user } = useAuth();
  const { room, sendAnswer, sendVote, sendChat } = useRoom();
  const myId = String(user.id);

  return (
    <div className="screen partie-screen">
      <ScoreBoard players={room.players} activePlayerId={room.currentTurn?.activePlayerId} />

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
