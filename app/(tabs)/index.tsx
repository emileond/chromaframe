import {ScrollView, StyleSheet, View} from 'react-native';

import {Card} from '@/components/ui/card';
import {Heading} from '@/components/ui/heading';
import {Text} from '@/components/ui/text';
import {ThemedView} from "@/components/themed-view";

const placeholders = Array.from({length: 8});

export default function HomeScreen() {
    return (
        <ScrollView>
            <ThemedView>
                <Heading size="xl" className="pt-12 pb-6 px-4">
                    Welcome
                </Heading>

                <View style={styles.grid}>
                    {placeholders.map((_, idx) => (
                        <Card key={idx} size="md" variant="elevated" style={styles.card}>
                            <View style={styles.placeholder}/>
                            <Text size="sm" className="mt-2 text-typography-600">
                                Saved image {idx + 1}
                            </Text>
                        </Card>
                    ))}
                </View>
            </ThemedView>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    grid: {
        paddingHorizontal: 16,
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        rowGap: 12,
    },
    card: {
        width: '48%',
        marginBottom: 12,
    },
    placeholder: {
        width: '100%',
        aspectRatio: 1,
        backgroundColor: '#e5e7eb', // gray-200
        borderRadius: 8,
    },
    reactLogo: {
        height: 178,
        width: 290,
        bottom: 0,
        left: 0,
        position: 'absolute',
    },
});
