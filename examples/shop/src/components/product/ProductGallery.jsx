import { useState } from 'react';

export default function ProductGallery({ images }) {
    const [index, setIndex] = useState(0);
    return (
        <div className="gallery">
            <img src={images[index]} alt="" />
            {images.map((src, i) => <button key={src} onClick={() => setIndex(i)} aria-label={`Image ${i + 1}`} />)}
        </div>
    );
}
