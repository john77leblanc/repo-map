import PostcodeLookup from './PostcodeLookup';

export default function AddressFields() {
    return (
        <fieldset>
            <legend>Address</legend>
            <input name="line1" required />
            <input name="city" required />
            <PostcodeLookup />
        </fieldset>
    );
}
