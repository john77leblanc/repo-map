import ReviewItem from './ReviewItem';

export default function ReviewThread({ reviews }) {
    if (!reviews.length) return null;
    return (
        <ul className="reviews">
            {reviews.map((review) => <ReviewItem key={review.id} review={review} />)}
        </ul>
    );
}
