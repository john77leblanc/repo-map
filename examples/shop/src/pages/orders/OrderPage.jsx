import { useEffect, useState } from 'react';
import PriceLine from '../../components/shared/PriceLine';

export default function OrderPage({ orderId }) {
    const [order, setOrder] = useState(null);
    useEffect(() => {
        fetch(`/api/orders/${orderId}`).then((r) => r.json()).then(setOrder);
    }, [orderId]);
    if (!order) return <p>Loading...</p>;
    return (
        <main>
            <h1>Thanks! Order {order.id} is confirmed.</h1>
            <PriceLine label="Charged" cents={order.total} strong />
            <a href="/">Keep shopping</a>
        </main>
    );
}
