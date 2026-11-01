import ReviewThread from './ReviewThread';

export default function ReviewItem({ review }) {
    return (
        <li>
            <p><b>{review.author}</b> rated it {review.stars}/5</p>
            <p>{review.text}</p>
            <ReviewThread reviews={review.replies} />
        </li>
    );
}
