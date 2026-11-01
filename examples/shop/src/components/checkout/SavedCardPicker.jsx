import { useContext } from 'react';
import { AccountContext } from '../../stores/account';
import Button from '../shared/Button';

export default function SavedCardPicker({ onPick }) {
    const account = useContext(AccountContext);
    if (!account?.cards.length) return null;
    return (
        <ul className="saved-cards">
            {account.cards.map((card) => (
                <li key={card.id}><Button variant="secondary" onClick={() => onPick(card)}>Card ending {card.last4}</Button></li>
            ))}
        </ul>
    );
}
